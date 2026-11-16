import { expenseLines, incomeLines } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  budgetSheetFor,
  categoryTotalsIn,
  createAccount,
  dailyTotalsIn,
  essentialSplitIn,
  inBook,
  instalmentSpendingIn,
  listAccounts,
  listInstallments,
  periodFlows,
  personalBook,
  postTransaction,
  saveBudget,
  saveCardTerms,
  saveCategoryNeed,
  saveInstallment,
  setBookMonthStart,
  setInstallmentCountMode,
  uncategorisedCategory,
  updateInstallment,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Card instalments, option C (0120). Invented: a laptop bought on a card on 10 Nov 2026 for Rp 12.000.000, converted to
 * 12 × Rp 1.000.000 first billed in December, statement day the 18th; groceries Rp 640.000 on 18 Dec; salary in
 * November and December.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const NOV = { from: '2026-11-01', to: '2026-11-30' };
const DEC = { from: '2026-12-01', to: '2026-12-31' };

async function laptop(opts: { countMode?: 'at_purchase' | 'each_month'; link?: boolean; excluded?: boolean } = {}) {
  current = await setupDb();
  const { database } = current;
  const book = await personalBook(database, current.ws);
  const ws = inBook(current.ws, book.id);
  const bank = await createAccount(database, ws, { name: 'Bank Sentosa', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const card = await createAccount(database, ws, { name: 'Visa Kencana', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 18, dueDay: 5, creditLimitMinor: null, annualFeeMinor: null });
  const all = await listAccounts(database, ws);
  const electronics = all.find((a) => a.systemKey === 'shopping.electronics')!.id;
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
  const salary = all.find((a) => a.systemKey === 'income.salary')!.id;
  const purchase = await postTransaction(database, ws, {
    occurredOn: '2026-11-10',
    description: 'Laptop',
    lines: expenseLines({ categoryAccountId: electronics, paymentAccountId: card.id, amountMinor: 12_000_000, currency: 'IDR' }),
    ...(opts.excluded ? { excludedFromReport: true } : {}),
  });
  await postTransaction(database, ws, { occurredOn: '2026-12-18', description: 'Supermarket', lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: card.id, amountMinor: 640_000, currency: 'IDR' }) });
  for (const on of ['2026-11-01', '2026-12-01']) {
    await postTransaction(database, ws, { occurredOn: on, description: 'Gaji', lines: incomeLines({ incomeAccountId: salary, depositAccountId: bank.id, amountMinor: 20_000_000, currency: 'IDR' }) });
  }
  const planId = await saveInstallment(database, ws, {
    cardAccountId: card.id,
    description: 'Laptop',
    totalMinor: 12_000_000,
    months: 12,
    firstBilledMonth: '2026-12',
    transactionId: opts.link === false ? null : purchase,
    ...(opts.countMode ? { countMode: opts.countMode } : {}),
  });
  return { database, ws, book, bank, card, electronics, groceries, salary, purchase, planId };
}

const spentIn = async (database: TestDb['database'], ws: Awaited<ReturnType<typeof laptop>>['ws'], range: { from: string; to: string }) =>
  (await categoryTotalsIn(database, ws, 'expense', range.from, range.to, { billMonths: true })).rows;
const total = (rows: { amountBaseMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);

describe('a plan’s count mode', () => {
  it('is Each month for a new plan, and can be set', async () => {
    const h = await laptop();
    expect((await listInstallments(h.database, h.ws))[0]!.countMode).toBe('each_month');
    await setInstallmentCountMode(h.database, h.ws, h.planId, 'at_purchase');
    expect((await listInstallments(h.database, h.ws))[0]!.countMode).toBe('at_purchase');
    await expect(setInstallmentCountMode(h.database, h.ws, h.planId, 'weekly' as never)).rejects.toThrow('At purchase or Each month');
  });

  it('refuses a purchase made on another card, or one another plan already spreads', async () => {
    const h = await laptop();
    const other = await createAccount(h.database, h.ws, { name: 'Master Emas', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await expect(
      saveInstallment(h.database, h.ws, { cardAccountId: other.id, description: 'x', totalMinor: 1_000_000, months: 2, firstBilledMonth: '2026-12', transactionId: h.purchase }),
    ).rejects.toThrow('made on this card');
    await expect(
      saveInstallment(h.database, h.ws, { cardAccountId: h.card.id, description: 'x', totalMinor: 1_000_000, months: 2, firstBilledMonth: '2026-12', transactionId: h.purchase }),
    ).rejects.toThrow('already another plan');
  });

  it('can tie a plan to its purchase later', async () => {
    const h = await laptop({ link: false });
    await updateInstallment(h.database, h.ws, { id: h.planId, description: 'Laptop', totalMinor: 12_000_000, months: 12, firstBilledMonth: '2026-12', earnsPoints: true, transactionId: h.purchase });
    expect((await listInstallments(h.database, h.ws))[0]!.transactionId).toBe(h.purchase);
  });
});

describe('Each month', () => {
  it('counts nothing for the purchase in November and each instalment in its own month', async () => {
    const h = await laptop();
    expect(total(await spentIn(h.database, h.ws, NOV))).toBe(0);
    const dec = await spentIn(h.database, h.ws, DEC);
    expect(dec.find((row) => row.accountId === h.electronics)).toMatchObject({ amountBaseMinor: 1_000_000, transactions: 1 });
    expect(total(dec)).toBe(1_640_000);
    // The twelfth and last falls on 18 Nov 2027.
    expect(total(await spentIn(h.database, h.ws, { from: '2027-11-01', to: '2027-11-30' }))).toBe(1_000_000);
    expect(total(await spentIn(h.database, h.ws, { from: '2026-01-01', to: '2027-12-31' }))).toBe(12_640_000);
  });

  it('puts the instalment on its statement day in the bars', async () => {
    const h = await laptop();
    expect((await dailyTotalsIn(h.database, h.ws, 'expense', DEC.from, DEC.to, { billMonths: true })).days).toEqual([{ date: '2026-12-18', amountMinor: 1_640_000 }]);
    expect((await dailyTotalsIn(h.database, h.ws, 'expense', NOV.from, NOV.to, { billMonths: true })).days).toEqual([]);
  });

  it('lists the instalment lines Cashflow draws, and the purchase they spread', async () => {
    const h = await laptop();
    const read = await instalmentSpendingIn(h.database, h.ws, DEC.from, DEC.to);
    expect(read.spreadPurchaseIds).toEqual([h.purchase]);
    expect(read.lines).toEqual([
      expect.objectContaining({ planId: h.planId, transactionId: h.purchase, number: 1, of: 12, statementOn: '2026-12-18', categoryId: h.electronics, amountBaseMinor: 1_000_000 }),
    ]);
  });

  it('counts the budget’s spent, per category, by the month', async () => {
    const h = await laptop();
    await saveBudget(h.database, h.ws, { categoryAccountId: h.electronics, amountMinor: 1_500_000 });
    const nov = await budgetSheetFor(h.database, h.ws, '2026-11');
    const dec = await budgetSheetFor(h.database, h.ws, '2026-12');
    expect(nov.spendingActualMinor).toBe(0);
    expect(dec.spendingActualMinor).toBe(1_640_000);
    // Not also a debt payment.
    expect(dec.debtPaymentsActualMinor).toBe(0);
  });

  it('counts in the split by the purchase category’s mark', async () => {
    const h = await laptop();
    await saveCategoryNeed(h.database, h.ws, h.electronics, 'lifestyle');
    const dec = await essentialSplitIn(h.database, h.ws, DEC.from, DEC.to, { excludeEvents: true });
    expect(dec.split.lifestyleMinor).toBe(1_000_000);
    expect(dec.split.essentialMinor).toBe(640_000);
    const nov = await essentialSplitIn(h.database, h.ws, NOV.from, NOV.to, { excludeEvents: true });
    expect(nov.split.lifestyleMinor).toBe(0);
  });

  it('is spending in Financial health, never also a debt payment', async () => {
    const h = await laptop();
    await saveCategoryNeed(h.database, h.ws, h.electronics, 'lifestyle');
    const flows = await periodFlows(h.database, h.ws, { from: NOV.from, to: DEC.to });
    expect(flows.byMonth).toEqual([
      { month: '2026-11', incomeMinor: 20_000_000, spendingMinor: 0, debtPaymentsMinor: 0 },
      { month: '2026-12', incomeMinor: 20_000_000, spendingMinor: 1_640_000, debtPaymentsMinor: 0 },
    ]);
    expect(flows.debtPaymentsMinor).toBe(0);
    expect(flows.lifestyleSpendingMinor).toBe(1_000_000);
  });

  it('counts in the month its statement date falls in when months start on the 25th', async () => {
    const h = await laptop();
    await setBookMonthStart(h.database, h.ws, h.book.id, 25);
    // "December" runs 25 Nov – 24 Dec: the 18 Dec instalment and the groceries.
    const flows = await periodFlows(h.database, h.ws, { from: '2026-11-25', to: '2026-12-24' });
    expect(flows.byMonth).toEqual([{ month: '2026-12', incomeMinor: 20_000_000, spendingMinor: 1_640_000, debtPaymentsMinor: 0 }]);
    expect((await budgetSheetFor(h.database, h.ws, '2026-12')).spendingActualMinor).toBe(1_640_000);
    expect((await budgetSheetFor(h.database, h.ws, '2026-11')).spendingActualMinor).toBe(0);
  });

  it('leaves the instalments out with the purchase when the purchase is excluded', async () => {
    const h = await laptop({ excluded: true });
    expect(total(await spentIn(h.database, h.ws, DEC))).toBe(640_000);
    expect((await periodFlows(h.database, h.ws, DEC)).spendingMinor).toBe(640_000);
  });

  it('follows the Paid with filter: the card paid the instalment, the bank did not', async () => {
    const h = await laptop();
    const onCard = await categoryTotalsIn(h.database, h.ws, 'expense', DEC.from, DEC.to, { billMonths: true, paidAccountId: h.card.id });
    expect(total(onCard.rows)).toBe(1_640_000);
    const onBank = await categoryTotalsIn(h.database, h.ws, 'expense', DEC.from, DEC.to, { billMonths: true, paidAccountId: h.bank.id });
    expect(total(onBank.rows)).toBe(0);
  });

  it('counts a plan with no purchase under Uncategorised', async () => {
    const h = await laptop({ link: false, countMode: 'each_month' });
    const unfiled = await uncategorisedCategory(h.database, h.ws, 'expense');
    const dec = await spentIn(h.database, h.ws, DEC);
    expect(dec.find((row) => row.accountId === unfiled)?.amountBaseMinor).toBe(1_000_000);
    // The purchase, not tied to the plan, still counts on its own day.
    expect(total(await spentIn(h.database, h.ws, NOV))).toBe(12_000_000);
  });
});

describe('At purchase', () => {
  it('counts the whole purchase in November and the instalment only as a debt payment', async () => {
    const h = await laptop({ countMode: 'at_purchase' });
    expect(total(await spentIn(h.database, h.ws, NOV))).toBe(12_000_000);
    expect(total(await spentIn(h.database, h.ws, DEC))).toBe(640_000);
    const flows = await periodFlows(h.database, h.ws, { from: NOV.from, to: DEC.to });
    expect(flows.byMonth).toEqual([
      { month: '2026-11', incomeMinor: 20_000_000, spendingMinor: 12_000_000, debtPaymentsMinor: 0 },
      { month: '2026-12', incomeMinor: 20_000_000, spendingMinor: 640_000, debtPaymentsMinor: 1_000_000 },
    ]);
    expect((await budgetSheetFor(h.database, h.ws, '2026-11')).spendingActualMinor).toBe(12_000_000);
    expect((await instalmentSpendingIn(h.database, h.ws, DEC.from, DEC.to)).lines).toEqual([]);
  });

  it('counts nothing more for a plan with no purchase', async () => {
    const h = await laptop({ link: false, countMode: 'at_purchase' });
    expect(total(await spentIn(h.database, h.ws, DEC))).toBe(640_000);
  });
});

describe('where each instalment stands', () => {
  it('is upcoming, then billed on its statement date, then paid once a payment covers that statement', async () => {
    const { planInstalmentStatuses, transferLines } = { ...(await import('../src/index')), ...(await import('@expanses/core')) };
    const h = await laptop();
    const before = await planInstalmentStatuses(h.database, h.ws, h.planId, '2026-12-10');
    expect(before.map((row) => row.status)).toEqual(Array(12).fill('upcoming'));
    const billed = await planInstalmentStatuses(h.database, h.ws, h.planId, '2026-12-20');
    expect(billed.slice(0, 2).map((row) => [row.number, row.statementOn, row.status])).toEqual([
      [1, '2026-12-18', 'billed'],
      [2, '2027-01-18', 'upcoming'],
    ]);
    // The December statement (Rp 1.640.000) paid in full on 2 Jan.
    await postTransaction(h.database, h.ws, { occurredOn: '2027-01-02', description: 'Pay the card', lines: transferLines({ fromAccountId: h.bank.id, toAccountId: h.card.id, amountMinor: 1_640_000, currency: 'IDR' }) });
    const paid = await planInstalmentStatuses(h.database, h.ws, h.planId, '2027-01-05');
    expect(paid[0]!.status).toBe('paid');
    expect(paid[1]!.status).toBe('upcoming');
  });
});
