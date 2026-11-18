import { afterEach, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
  dailyTotalsIn,
  essentialSplitIn,
  linkPurchaseToBill,
  listAccounts,
  listTransactions,
  postTransaction,
  recordBillPayments,
  saveExpenseTemplate,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * Yearly bills on a month's Cashflow (owner, 2026-11-18): `leaveOutYearlyBills` leaves a payment linked to a bill whose
 * repeat is yearly out of the ring, the bars and the income split; without it — a year, every report — it counts.
 * Invented figures throughout.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'Test Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bank.id };
  const gym = await saveExpenseTemplate(database, ws, { ...base, name: 'Gym', dayOfMonth: 5, amountMinor: 410_000, startsMonth: '2027-01' });
  const cover = await saveExpenseTemplate(database, ws, { ...base, name: 'Cover', dayOfMonth: 5, amountMinor: 7_300_000, repeat: 'yearly', repeatMonth: 3, startsMonth: '2027-03' });
  const buy = (occurredOn: string, amountMinor: number, description = 'Shop') =>
    postTransaction(database, ws, {
      occurredOn,
      description,
      lines: [
        { accountId: category, amountMinor, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  return { database, ws, bank, category, gym, cover, buy };
}

const spent = (rows: readonly { amountBaseMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);

it('leaves a paid yearly bill out of a month asked so, and counts a monthly bill and an unlinked purchase', async () => {
  const h = await household();
  const [yearly] = await recordBillPayments(h.database, h.ws, { paidOn: '2027-03-05', payments: [{ templateId: h.cover, billMonth: '2027-03', amountMinor: 7_300_000 }] });
  await recordBillPayments(h.database, h.ws, { paidOn: '2027-03-06', payments: [{ templateId: h.gym, billMonth: '2027-03', amountMinor: 410_000 }] });
  await h.buy('2027-03-07', 63_000);
  const month = (leaveOutYearlyBills?: boolean) => categoryTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true, leaveOutYearlyBills });

  expect(spent((await month(true)).rows)).toBe(410_000 + 63_000);
  expect((await month(true)).rows[0]!.transactions).toBe(2);
  // Not asked (a year, a report, the switch on): it counts like any spending.
  expect(spent((await month()).rows)).toBe(7_300_000 + 410_000 + 63_000);
  expect(spent((await month(false)).rows)).toBe(7_300_000 + 410_000 + 63_000);
  // The year counts it.
  expect(spent((await categoryTotalsIn(h.database, h.ws, 'expense', '2027-01-01', '2027-12-31', { billMonths: true })).rows)).toBe(7_773_000);

  // The list says which row paid a yearly bill, so Cashflow can grey it; the others say nothing.
  const listed = await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' });
  expect(listed.filter((tx) => tx.yearlyBill).map((tx) => tx.id)).toEqual([yearly]);
  expect(listed).toHaveLength(3);
});

it('a purchase linked to a yearly bill afterwards is left out the same way', async () => {
  const h = await household();
  const id = await h.buy('2027-03-09', 7_300_000, 'Cover premium');
  await h.buy('2027-03-10', 52_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.cover, billMonth: '2027-03', transactionId: id, today: '2027-03-20' });
  const totals = await categoryTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true, leaveOutYearlyBills: true });
  expect(spent(totals.rows)).toBe(52_000);
  expect((await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' })).find((tx) => tx.id === id)?.yearlyBill).toBe(true);
});

it('the bars and the income split leave it out alike, so the days add up to the ring', async () => {
  const h = await household();
  await recordBillPayments(h.database, h.ws, { paidOn: '2027-03-05', payments: [{ templateId: h.cover, billMonth: '2027-03', amountMinor: 7_300_000 }] });
  await h.buy('2027-03-05', 41_000);
  const days = await dailyTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true, leaveOutYearlyBills: true });
  expect(days.days).toEqual([{ date: '2027-03-05', amountMinor: 41_000 }]);
  const all = await dailyTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true });
  expect(all.days).toEqual([{ date: '2027-03-05', amountMinor: 7_341_000 }]);

  const out = await essentialSplitIn(h.database, h.ws, '2027-03-01', '2027-03-31', { excludeEvents: true, leaveOutYearlyBills: true });
  const kept = await essentialSplitIn(h.database, h.ws, '2027-03-01', '2027-03-31', { excludeEvents: true });
  const total = (split: typeof out) => split.split.spendingMinor;
  expect(total(out)).toBe(41_000);
  expect(total(kept)).toBe(7_341_000);
});
