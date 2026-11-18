import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
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
 * Not-monthly costs on a month's Cashflow (owner, 2026-11-18): `leaveOutNotMonthly` leaves a payment linked to a bill
 * that repeats yearly, or every 2 months or more, out of the ring, the bars and the income split; without it — a year,
 * every report — it counts. A monthly bill, and a purchase linked to nothing, always count. Invented figures throughout.
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
  const every = (name: string, months: number) =>
    saveExpenseTemplate(database, ws, { ...base, name, dayOfMonth: 5, amountMinor: 1_000_000 * months, repeat: 'months', repeatMonth: 3, repeatEvery: months, startsMonth: '2027-03' });
  const buy = (occurredOn: string, amountMinor: number, description = 'Shop') =>
    postTransaction(database, ws, {
      occurredOn,
      description,
      lines: [
        { accountId: category, amountMinor, currency: 'IDR' },
        { accountId: bank.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  const pay = async (templateId: string, amountMinor: number, paidOn = '2027-03-05') =>
    (await recordBillPayments(database, ws, { paidOn, payments: [{ templateId, billMonth: '2027-03', amountMinor }] }))[0]!;
  return { database, ws, bank, category, gym, cover, every, buy, pay };
}

const spent = (rows: readonly { amountBaseMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountBaseMinor, 0);
const march = (h: Awaited<ReturnType<typeof household>>, leaveOutNotMonthly?: boolean) =>
  categoryTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true, leaveOutNotMonthly });

it('leaves a paid yearly bill out of a month asked so, and counts a monthly bill and an unlinked purchase', async () => {
  const h = await household();
  const yearly = await h.pay(h.cover, 7_300_000);
  await h.pay(h.gym, 410_000, '2027-03-06');
  await h.buy('2027-03-07', 63_000);

  expect(spent((await march(h, true)).rows)).toBe(410_000 + 63_000);
  expect((await march(h, true)).rows[0]!.transactions).toBe(2);
  // Not asked (a year, a report, Shown): it counts like any spending.
  expect(spent((await march(h)).rows)).toBe(7_300_000 + 410_000 + 63_000);
  expect(spent((await march(h, false)).rows)).toBe(7_300_000 + 410_000 + 63_000);
  // The year counts it.
  expect(spent((await categoryTotalsIn(h.database, h.ws, 'expense', '2027-01-01', '2027-12-31', { billMonths: true })).rows)).toBe(7_773_000);

  // The list says which row paid a not-monthly bill, so Cashflow can grey it; the others say nothing.
  const listed = await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' });
  expect(listed.filter((tx) => tx.notMonthlyBill).map((tx) => tx.id)).toEqual([yearly]);
  expect(listed).toHaveLength(3);
});

describe('every few months', () => {
  it('every 2, 3 and 6 months are not monthly: left out of the month, counted in the year', async () => {
    const h = await household();
    const paid = [await h.pay(await h.every('Filter', 2), 2_000_000), await h.pay(await h.every('Water', 3), 3_000_000), await h.pay(await h.every('Car service', 6), 6_000_000)];
    await h.pay(h.gym, 410_000);

    expect(spent((await march(h, true)).rows)).toBe(410_000);
    expect(spent((await march(h, false)).rows)).toBe(11_000_000 + 410_000);
    const listed = await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' });
    expect(listed.filter((tx) => tx.notMonthlyBill).map((tx) => tx.id).sort()).toEqual([...paid].sort());
  });

  it("a 'months' bill every 1 month reads as monthly and always counts", async () => {
    const h = await household();
    // The form refuses a gap of 1; a database could still hold one (written by hand here), and it is every month.
    const odd = await h.every('Odd', 2);
    await h.database.db.run(sql`UPDATE expense_templates SET repeat_every = 1 WHERE id = ${odd}`);
    const id = await h.pay(odd, 500_000);
    expect(spent((await march(h, true)).rows)).toBe(500_000);
    expect((await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' })).find((tx) => tx.id === id)?.notMonthlyBill).toBeUndefined();
  });

  it('turning a bill monthly again counts its past payments in their month', async () => {
    const h = await household();
    const car = await h.every('Car service', 6);
    await h.pay(car, 6_000_000);
    expect(spent((await march(h, true)).rows)).toBe(0);
    await h.database.db.run(sql`UPDATE expense_templates SET repeat = NULL, repeat_month = NULL, repeat_every = NULL WHERE id = ${car}`);
    expect(spent((await march(h, true)).rows)).toBe(6_000_000);
  });
});

it('a purchase linked to a not-monthly bill afterwards is left out the same way', async () => {
  const h = await household();
  const id = await h.buy('2027-03-09', 7_300_000, 'Cover premium');
  await h.buy('2027-03-10', 52_000);
  await linkPurchaseToBill(h.database, h.ws, { templateId: h.cover, billMonth: '2027-03', transactionId: id, today: '2027-03-20' });
  expect(spent((await march(h, true)).rows)).toBe(52_000);
  expect((await listTransactions(h.database, h.ws, { from: '2027-03-01', to: '2027-03-31' })).find((tx) => tx.id === id)?.notMonthlyBill).toBe(true);

  const service = await h.buy('2027-03-11', 6_000_000, 'Car service');
  await linkPurchaseToBill(h.database, h.ws, { templateId: await h.every('Car service', 6), billMonth: '2027-03', transactionId: service, today: '2027-03-20' });
  expect(spent((await march(h, true)).rows)).toBe(52_000);
});

it('the bars and the income split leave them out alike, so the days add up to the ring', async () => {
  const h = await household();
  await h.pay(h.cover, 7_300_000);
  await h.pay(await h.every('Car service', 6), 6_000_000);
  await h.buy('2027-03-05', 41_000);
  const days = await dailyTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true, leaveOutNotMonthly: true });
  expect(days.days).toEqual([{ date: '2027-03-05', amountMinor: 41_000 }]);
  const all = await dailyTotalsIn(h.database, h.ws, 'expense', '2027-03-01', '2027-03-31', { billMonths: true });
  expect(all.days).toEqual([{ date: '2027-03-05', amountMinor: 13_341_000 }]);

  const out = await essentialSplitIn(h.database, h.ws, '2027-03-01', '2027-03-31', { excludeEvents: true, leaveOutNotMonthly: true });
  const kept = await essentialSplitIn(h.database, h.ws, '2027-03-01', '2027-03-31', { excludeEvents: true });
  expect(out.split.spendingMinor).toBe(41_000);
  expect(kept.split.spendingMinor).toBe(13_341_000);
});
