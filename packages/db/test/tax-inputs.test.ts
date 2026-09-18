import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  coretaxInputsFor,
  createAccount,
  type Database,
  postTransaction,
  recordLoan,
  recordLoanPayment,
  recordRepayment,
  recordTrade,
  saveAssetProfile,
  saveDebtProfile,
  saveLoanTerms,
  upsertPrice,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = 2026;

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let gold: AccountRow;
let house: AccountRow;
let card: AccountRow;
let kpr: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  gold = await createAccount(database, ws, { name: 'Antam gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR', openingBalanceMinor: 900_000_000, openedOn: '2021-03-25' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold', coretaxFields: { info: 'Emas batangan Antam' } });
  await saveAssetProfile(database, ws, { accountId: house.id, assetKind: 'property' });
  await saveAssetProfile(database, ws, { accountId: bca.id, assetKind: 'cash', coretaxFields: { owner: 'Fandrian', inst: 'BCA', loc: 'IDN' } });
});

const buyGold = (occurredOn: string, grams: number, grossMinor: number) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn,
    unitsMicro: grams * 1_000_000,
    grossMinor,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: null,
  });

const spendOnCard = (occurredOn: string, amountMinor: number) =>
  postTransaction(database, ws, {
    occurredOn,
    description: 'Shopping',
    lines: [
      { accountId: 'placeholder', amountMinor, currency: 'IDR' },
      { accountId: card.id, amountMinor: -amountMinor, currency: 'IDR' },
    ],
  });

describe('what the year holds', () => {
  it('reads a bank balance as it stood on 31 December, not today', async () => {
    await postTransaction(database, ws, {
      occurredOn: '2027-02-01',
      description: 'Later salary',
      lines: [
        { accountId: bca.id, amountMinor: 20_000_000, currency: 'IDR' },
        { accountId: (await createAccount(database, ws, { name: 'Salary', kind: 'income', subtype: 'category', currency: null })).id, amountMinor: -20_000_000, currency: 'IDR' },
      ],
    });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.cash.find((row) => row.accountId === bca.id)).toMatchObject({ balanceMinor: 50_000_000, code: '0102' });
  });

  it('carries the fields the owner filled in for the section', async () => {
    const inputs = await coretaxInputsFor(database, ws, YEAR);

    expect(inputs.cash.find((row) => row.accountId === bca.id)!.fields).toMatchObject({ owner: 'Fandrian', inst: 'BCA' });
  });

  it('splits a holding by the year each parcel was bought', async () => {
    await buyGold('2024-02-03', 10, 13_100_000);
    await buyGold('2026-03-09', 5, 9_300_000);
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-12-31', priceMicro: 1_900_000_000_000 });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    const holding = inputs.holdings.find((row) => row.accountId === gold.id)!;
    expect(Object.keys(holding.byYear).sort()).toEqual(['2024', '2026']);
    expect(holding.byYear['2024']).toMatchObject({ unitsMicro: 10_000_000, costMinor: 13_100_000 });
    expect(holding.code).toBe('0701');
  });

  it('prices a holding at the last price on or before 31 December', async () => {
    await buyGold('2024-02-03', 10, 13_100_000);
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2026-12-30', priceMicro: 1_900_000_000_000 });
    // A price from the following year must not reach the report.
    await upsertPrice(database, ws, { accountId: gold.id, onDate: '2027-03-01', priceMicro: 2_500_000_000_000 });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.holdings.find((row) => row.accountId === gold.id)!.priceMicro).toBe(1_900_000_000_000);
  });

  it('leaves out a holding bought after the year ended', async () => {
    await buyGold('2027-01-05', 5, 9_300_000);

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.holdings.find((row) => row.accountId === gold.id)).toBeUndefined();
  });

  it('reports a property at what it cost and what it is estimated at', async () => {
    const inputs = await coretaxInputsFor(database, ws, YEAR);

    expect(inputs.estimated.find((row) => row.accountId === house.id)).toMatchObject({ code: '0502', costMinor: 900_000_000 });
  });

  it('reports what the card owed on 31 December', async () => {
    const shopping = await createAccount(database, ws, { name: 'Shopping', kind: 'expense', subtype: 'category', currency: null });
    await postTransaction(database, ws, {
      occurredOn: '2026-11-20',
      description: 'Shopping',
      lines: [
        { accountId: shopping.id, amountMinor: 4_000_000, currency: 'IDR' },
        { accountId: card.id, amountMinor: -4_000_000, currency: 'IDR' },
      ],
    });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.debts.find((row) => row.accountId === card.id)).toMatchObject({ code: '102', balanceMinor: 4_000_000 });
    expect(spendOnCard).toBeTypeOf('function');
  });

  it('reports a loan at its balance, not at its schedule', async () => {
    await saveLoanTerms(database, ws, {
      accountId: kpr.id,
      lenderName: 'Bank BTN',
      originalMinor: 700_000_000,
      firstPaymentOn: '2026-01-25',
      tenorMonths: 180,
      method: 'annuity',
      paymentDay: 25,
      rateBps: 900,
    });
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 1_849_866, interestMinor: 5_250_000 });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.debts.find((row) => row.accountId === kpr.id)).toMatchObject({ code: '101', balanceMinor: 698_150_134, note: 'Bank BTN' });
  });

  it('includes a personal debt still open, and leaves out one settled in the year', async () => {
    const lent = await recordLoan(database, ws, {
      person: { name: 'Andi', direction: 'lent', currency: 'IDR' },
      occurredOn: '2026-05-01',
      amountMinor: 9_000_000,
      moneyAccountId: bca.id,
    });
    const repaid = await recordLoan(database, ws, {
      person: { name: 'Budi', direction: 'lent', currency: 'IDR' },
      occurredOn: '2026-05-01',
      amountMinor: 3_000_000,
      moneyAccountId: bca.id,
    });
    await recordRepayment(database, ws, { debtAccountId: repaid.debtAccountId, occurredOn: '2026-11-01', amountMinor: 3_000_000, moneyAccountId: bca.id });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.receivables.map((row) => row.accountId)).toEqual([lent.debtAccountId]);
    expect(inputs.receivables[0]).toMatchObject({ code: '0201', balanceMinor: 9_000_000 });
  });

  it('names the person on a receivable, which the form asks for', async () => {
    const lent = await recordLoan(database, ws, {
      person: { name: 'Andi', direction: 'lent', currency: 'IDR', personIdNumber: '3174010101900001' },
      occurredOn: '2026-05-01',
      amountMinor: 9_000_000,
      moneyAccountId: bca.id,
    });
    await saveDebtProfile(database, ws, { accountId: lent.debtAccountId, personName: 'Andi', personIdNumber: '3174010101900001' });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.receivables[0]!.fields).toMatchObject({ name: 'Andi' });
  });

  it('keeps a foreign account in its own currency, for the KMK rate to convert', async () => {
    const citi = await createAccount(database, ws, { name: 'Citibank USD', kind: 'asset', subtype: 'bank', currency: 'USD', openingBalanceMinor: 100_000, openedOn: '2026-01-01', openingRateToBase: 16_000 });

    const inputs = await coretaxInputsFor(database, ws, YEAR);
    expect(inputs.cash.find((row) => row.accountId === citi.id)).toMatchObject({ currency: 'USD', balanceMinor: 100_000 });
  });

  it('has nothing to report for a year before anything was recorded', async () => {
    const inputs = await coretaxInputsFor(database, ws, 2019);

    expect(inputs.cash).toEqual([]);
    expect(inputs.holdings).toEqual([]);
    expect(inputs.debts).toEqual([]);
  });
});

describe('the code a money account files under', () => {
  // The file's own beforeEach already opened BCA, gold, the house, the card and the KPR through setupDb;
  // these two tests add to that workspace rather than making another.
  it('follows its kind of account when the owner has never chosen one', async () => {
    const opened: Record<string, string> = {};
    for (const subtype of ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash'] as const) {
      const account = await createAccount(database, ws, { name: `A ${subtype}`, kind: 'asset', subtype, currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01' });
      opened[subtype] = account.id;
    }
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const codeOf = (subtype: string) => inputs.cash.find((row) => row.accountId === opened[subtype])!.code;
    expect(codeOf('cash')).toBe('0101');
    expect(codeOf('bank')).toBe('0102');
    expect(codeOf('savings')).toBe('0102');
    expect(codeOf('time_deposit')).toBe('0104');
    expect(codeOf('ewallet')).toBe('0105');
    expect(codeOf('fund')).toBe('0109');
    expect(codeOf('other_cash')).toBe('0109');
  });

  it('never overrules a code the owner did choose', async () => {
    const wallet = await createAccount(database, ws, { name: 'GoPay', kind: 'asset', subtype: 'ewallet', currency: 'IDR', openingBalanceMinor: 500_000, openedOn: '2026-01-01' });
    await saveAssetProfile(database, ws, { accountId: wallet.id, assetKind: 'cash', coretaxSection: 'kas', coretaxCode: '0109' });
    const inputs = await coretaxInputsFor(database, ws, 2026);
    expect(inputs.cash.find((row) => row.accountId === wallet.id)!.code).toBe('0109');
  });
});
