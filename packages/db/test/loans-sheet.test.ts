import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  createAccount,
  type Database,
  periodFlows,
  recordLoanPayment,
  saveInstallment,
  saveLoanTerms,
  scheduleFor,
  sheetInputsAt,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const YEAR = { from: '2026-01-01', to: '2026-12-31' };
const ON = '2026-01-01';

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let house: AccountRow;
let car: AccountRow;
let kpr: AccountRow;
let carLoan: AccountRow;
let card: AccountRow;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 200_000_000, openedOn: '2026-01-01' });
  house = await createAccount(database, ws, { name: 'House in Bintaro', kind: 'asset', subtype: 'property', currency: 'IDR' });
  car = await createAccount(database, ws, { name: 'Avanza', kind: 'asset', subtype: 'vehicle', currency: 'IDR' });
  kpr = await createAccount(database, ws, { name: 'KPR Bintaro', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 700_000_000, openedOn: '2026-01-01' });
  carLoan = await createAccount(database, ws, { name: 'Avanza credit', kind: 'liability', subtype: 'loan', currency: 'IDR', openingBalanceMinor: 60_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 24_000_000, openedOn: '2026-01-01' });
});

const kprTerms = () =>
  saveLoanTerms(database, ws, {
    accountId: kpr.id,
    lenderName: 'Bank BTN',
    originalMinor: 700_000_000,
    firstPaymentOn: '2026-01-25',
    tenorMonths: 180,
    method: 'annuity',
    paymentDay: 25,
    rateBps: 900,
    assetAccountId: house.id,
  });

const carTerms = () =>
  saveLoanTerms(database, ws, {
    accountId: carLoan.id,
    lenderName: 'BCA Finance',
    originalMinor: 60_000_000,
    firstPaymentOn: '2026-01-10',
    tenorMonths: 36,
    method: 'flat',
    paymentDay: 10,
    rateBps: 500,
    assetAccountId: car.id,
  });

const liabilityOn = async (accountId: string, onDate = ON) =>
  (await sheetInputsAt(database, ws, onDate)).liabilities.find((row) => row.accountId === accountId);

describe('a loan on the balance sheet', () => {
  it('puts only the next twelve months of principal under Due within a year', async () => {
    await kprTerms();

    const rows = await scheduleFor(database, ws, kpr.id, ON);
    const nextTwelve = rows.slice(0, 12).reduce((total, row) => total + row.principalMinor, 0);
    const sheet = await liabilityOn(kpr.id);

    expect(nextTwelve).toBeGreaterThan(0);
    expect(sheet!.dueWithinYearMinor).toBe(nextTwelve);
    expect(sheet!.dueWithinYearMinor).toBeLessThan(sheet!.balanceMinor);
  });

  it('falls back to the whole balance when a loan has no terms yet', async () => {
    const sheet = await liabilityOn(kpr.id);

    expect(sheet!.dueWithinYearMinor).toBe(sheet!.balanceMinor);
  });

  it('follows the ledger after a payment', async () => {
    await kprTerms();
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 1_849_866, interestMinor: 5_250_000 });

    const sheet = await liabilityOn(kpr.id, '2026-02-01');
    expect(sheet!.balanceMinor).toBe(698_150_134);
  });
});

describe('card instalments on the balance sheet', () => {
  it('leaves what falls due beyond a year under Long-term', async () => {
    // A 24-month plan billed from this month: half of it falls beyond the year.
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2026-01' });

    const sheet = await liabilityOn(card.id);
    expect(sheet!.balanceMinor).toBe(24_000_000);
    expect(sheet!.dueWithinYearMinor).toBe(13_000_000);
  });

  it('keeps a short plan wholly within the year', async () => {
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Sofa', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-01' });

    const sheet = await liabilityOn(card.id);
    expect(sheet!.dueWithinYearMinor).toBe(sheet!.balanceMinor);
  });

  it('leaves a card with no plans owing all of it within the year', async () => {
    const sheet = await liabilityOn(card.id);

    expect(sheet!.dueWithinYearMinor).toBe(24_000_000);
  });
});

describe('which debts count against income', () => {
  it('keeps a mortgage out of the non-mortgage ratio without being told', async () => {
    await kprTerms();
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 1_849_866, interestMinor: 5_250_000 });

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(7_099_866);
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(0);
  });

  it('counts a car loan as consumer debt', async () => {
    await carTerms();
    await recordLoanPayment(database, ws, { accountId: carLoan.id, occurredOn: '2026-01-10', moneyAccountId: bca.id, principalMinor: 1_666_667, interestMinor: 250_000 });

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(1_916_667);
  });

  it('still honours a caller that names the home loans itself', async () => {
    await kprTerms();
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 1_849_866, interestMinor: 5_250_000 });

    const flows = await periodFlows(database, ws, YEAR, { homeLoanAccountIds: [] });
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(7_099_866);
  });
});

describe('instalments as debt payments', () => {
  it('counts what the card billed during the period', async () => {
    // Billed from February: eleven instalments fall inside 2026.
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-02' });

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(11_000_000);
    expect(flows.nonMortgageDebtPaymentsMinor).toBe(11_000_000);
  });

  it('counts nothing for a plan that starts after the period', async () => {
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2027-01' });

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(0);
  });

  it('adds instalments to the loan payments, not instead of them', async () => {
    await kprTerms();
    await recordLoanPayment(database, ws, { accountId: kpr.id, occurredOn: '2026-01-25', moneyAccountId: bca.id, principalMinor: 1_849_866, interestMinor: 5_250_000 });
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'iBox', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-02' });

    const flows = await periodFlows(database, ws, YEAR);
    expect(flows.debtPaymentsMinor).toBe(7_099_866 + 11_000_000);
  });
});
