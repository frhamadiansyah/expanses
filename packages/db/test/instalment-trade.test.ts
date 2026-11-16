import { statementCycleFor, transferLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  autoLinkInstalmentPlans,
  cardStatement,
  cardStatementLines,
  categoryTotalsIn,
  createAccount,
  inBook,
  listInstallments,
  listTrades,
  periodFlows,
  personalBook,
  postTransaction,
  recordTrade,
  saveAssetProfile,
  saveCardTerms,
  saveInstallment,
  setInstallmentCountMode,
  updateInstallment,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Turn into instalments on an investment bought with a card (owner, 16 Nov 2026, TF 139). Invented: a retail government
 * bond, Rp 6.000.000 bought with the card on 10 Nov 2026 (statement day the 18th), turned into 6 × Rp 1.000.000 from
 * December. Buying a bond is not spending: its instalments are card repayments, never spending.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const PAR = (rupiah: number) => rupiah * 1_000_000;

async function bond(paidWith: 'card' | 'bank' = 'card') {
  current = await setupDb();
  const { database } = current;
  const ws = inBook(current.ws, (await personalBook(database, current.ws)).id);
  const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-10-01' });
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-10-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 18, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const ori = await createAccount(database, ws, { name: 'ORI030', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: ori.id, assetKind: 'bond' });
  await recordTrade(database, ws, { accountId: ori.id, kind: 'buy', occurredOn: '2026-11-10', unitsMicro: PAR(6_000_000), grossMinor: 6_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: paidWith === 'card' ? card.id : bank.id });
  const buy = (await listTrades(database, ws, { accountId: ori.id }))[0]!.transactionId!;
  return { database, ws, card: card.id, bank: bank.id, ori: ori.id, buy };
}

const turn = (b: Awaited<ReturnType<typeof bond>>, countMode?: 'at_purchase' | 'each_month') =>
  saveInstallment(b.database, b.ws, { cardAccountId: b.card, description: 'ORI030', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-12', transactionId: b.buy, ...(countMode ? { countMode } : {}) });

describe('a plan tied to an investment bought with the card', () => {
  it('counts At purchase, and can never be set Each month', async () => {
    const b = await bond();
    const id = await turn(b);
    const plan = (await listInstallments(b.database, b.ws))[0]!;
    expect(plan).toMatchObject({ transactionId: b.buy, countMode: 'at_purchase', linkedToTrade: true });
    await expect(setInstallmentCountMode(b.database, b.ws, id, 'each_month')).rejects.toThrow('An investment is not spending');
    await expect(
      updateInstallment(b.database, b.ws, { id, description: 'ORI030', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-12', earnsPoints: false, countMode: 'each_month' }),
    ).rejects.toThrow('An investment is not spending');
    // A plan counting Each month cannot be tied to it either.
    const other = await saveInstallment(b.database, b.ws, { cardAccountId: b.card, description: 'x', totalMinor: 1_000_000, months: 2, firstBilledMonth: '2026-12' });
    await updateInstallment(b.database, b.ws, { id, description: 'ORI030', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-12', earnsPoints: false, transactionId: null });
    await expect(
      updateInstallment(b.database, b.ws, { id: other, description: 'x', totalMinor: 1_000_000, months: 2, firstBilledMonth: '2026-12', earnsPoints: false, transactionId: b.buy }),
    ).rejects.toThrow('An investment is not spending');
    await expect(turn(b, 'each_month')).rejects.toThrow('An investment is not spending');
  });

  it('bills a month at a time on the card’s statements, the buy itself counting nothing: nothing billed twice', async () => {
    const b = await bond();
    await turn(b);
    const lines = await cardStatementLines(b.database, b.ws, b.card);
    expect(lines.find((line) => line.transactionId === b.buy && !line.instalment)).toMatchObject({ trade: true, countedMinor: 0, convertedTo: { months: 6 } });
    const nov = await cardStatement(b.database, b.ws, b.card, statementCycleFor('2026-11-18', 18), '2026-11-20');
    expect(nov.closingMinor).toBe(0);
    const dec = await cardStatement(b.database, b.ws, b.card, statementCycleFor('2026-12-18', 18), '2026-12-20');
    expect(dec).toMatchObject({ chargesMinor: 1_000_000, closingMinor: 1_000_000, leftToPayMinor: 1_000_000 });
    expect(dec.lines.map((line) => [line.description, line.instalment?.number ?? null])).toEqual([['ORI030', 1]]);
    // Paid on 2 Jan: December's statement is covered, and January bills instalment 2 alone.
    await postTransaction(b.database, b.ws, { occurredOn: '2027-01-02', description: 'Pay the card', lines: transferLines({ fromAccountId: b.bank, toAccountId: b.card, amountMinor: 1_000_000, currency: 'IDR' }) });
    const decPaid = await cardStatement(b.database, b.ws, b.card, statementCycleFor('2026-12-18', 18), '2027-01-05');
    expect(decPaid.leftToPayMinor).toBe(0);
    expect(Object.values(decPaid.cover).every((c) => c.whole)).toBe(true);
    const jan = await cardStatement(b.database, b.ws, b.card, statementCycleFor('2027-01-18', 18), '2027-01-20');
    expect(jan).toMatchObject({ chargesMinor: 1_000_000, creditsMinor: 1_000_000, closingMinor: 1_000_000 });
  });

  it('is never spending, in any month; Health puts the buy away once and counts each instalment a debt repayment', async () => {
    const b = await bond();
    await turn(b);
    for (const [from, to] of [
      ['2026-11-01', '2026-11-30'],
      ['2026-12-01', '2026-12-31'],
      ['2027-05-01', '2027-05-31'],
    ]) {
      expect((await categoryTotalsIn(b.database, b.ws, 'expense', from!, to!, { billMonths: true })).rows).toEqual([]);
    }
    const flows = await periodFlows(b.database, b.ws, { from: '2026-11-01', to: '2027-05-31' });
    expect(flows.spendingMinor).toBe(0);
    // The buy, once: its instalments are repayments of the card, not a second putting away.
    expect(flows.putAwayMinor).toBe(6_000_000);
    expect(flows.debtPaymentsMinor).toBe(6_000_000);
  });

  it('the app opening ties an old plan of its total to the buy, At purchase', async () => {
    const b = await bond();
    const id = await saveInstallment(b.database, b.ws, { cardAccountId: b.card, description: 'ORI030', totalMinor: 6_000_000, months: 6, firstBilledMonth: '2026-12', countMode: 'at_purchase' });
    expect(await autoLinkInstalmentPlans(b.database, b.ws)).toMatchObject({ linked: 1 });
    expect((await listInstallments(b.database, b.ws)).find((p) => p.id === id)).toMatchObject({ transactionId: b.buy, countMode: 'at_purchase' });
  });
});

describe('a plan with no purchase from before the card’s records, At purchase (a bond added by hand)', () => {
  it('still bills its months on the statements, and counts as no spending', async () => {
    current = await setupDb();
    const { database } = current;
    const ws = inBook(current.ws, (await personalBook(database, current.ws)).id);
    const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 8_000_000, openedOn: '2026-09-01' });
    await saveCardTerms(database, ws, { accountId: card.id, statementDay: 13, dueDay: 2, creditLimitMinor: null, annualFeeMinor: null });
    await saveInstallment(database, ws, { cardAccountId: card.id, description: 'Bond', totalMinor: 24_000_000, months: 24, firstBilledMonth: '2025-02', countMode: 'at_purchase' });
    const lines = (await cardStatementLines(database, ws, card.id)).filter((line) => line.instalment);
    expect(lines.map((line) => line.instalment!.number)).toEqual([20, 21, 22, 23, 24]);
    expect((await categoryTotalsIn(database, ws, 'expense', '2026-09-01', '2027-01-31')).rows).toEqual([]);
  });
});
