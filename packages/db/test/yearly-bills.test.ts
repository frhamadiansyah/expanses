import { expenseLines, firstYearlyMonth, isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  committedByCategory,
  createAccount,
  dueExpenseTemplates,
  listAccounts,
  listExpenseTemplates,
  monthlyBills,
  pauseBill,
  postTransaction,
  recordBillPayments,
  saveExpenseTemplate,
  skipBill,
  yearlyBills,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function household() {
  current = await setupDb();
  const { database, ws } = current;
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bank.id };
  // A monthly bill beside it, to see that it is untouched.
  const gym = await saveExpenseTemplate(database, ws, { ...base, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, startsMonth: '2026-01' });
  // Tax on the car: out 12 March, every year.
  const car = await saveExpenseTemplate(database, ws, { ...base, name: 'Car tax', dayOfMonth: 12, amountMinor: 3_000_000, repeat: 'yearly', repeatMonth: 3, startsMonth: '2026-03' });
  return { database, ws, bank, category, base, gym, car };
}

const names = async (h: Awaited<ReturnType<typeof household>>, on: string) => (await monthlyBills(h.database, h.ws, on)).map((b) => b.name).sort();

it('stores the repeat by name, and reads a bill back as yearly with its month', async () => {
  const h = await household();
  const rows = await listExpenseTemplates(h.database, h.ws);
  expect(rows.find((r) => r.id === h.car)).toMatchObject({ repeat: 'yearly', repeatMonth: 3 });
  expect(rows.find((r) => r.id === h.gym)).toMatchObject({ repeat: 'monthly', repeatMonth: null });
  expect(await h.database.db.values(sql`SELECT repeat, repeat_month FROM expense_templates WHERE id = ${h.car}`)).toEqual([['yearly', 3]]);
});

it('a yearly bill needs its month', async () => {
  const h = await household();
  await expect(saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'X', dayOfMonth: 1, repeat: 'yearly' })).rejects.toMatchObject({ code: 'MONTH_REQUIRED' });
  await expect(saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'X', dayOfMonth: 1, repeat: 'yearly', repeatMonth: 13 })).rejects.toMatchObject({ code: 'MONTH_REQUIRED' });
});

it('is owed only in its own month: absent, not overdue, from every list the other eleven months', async () => {
  const h = await household();
  // A year earlier than anything: not started, and the monthly bill is all there is.
  expect(await names(h, '2026-08-01')).toEqual(['Gym']);
  expect(await names(h, '2026-12-31')).toEqual(['Gym']);
  expect(await names(h, '2026-04-25')).toEqual(['Car tax', 'Gym']); // March's unpaid bill is still late in April
  expect(await names(h, '2026-05-01')).toEqual(['Gym']); // and let go after
});

it('shows 30 days ahead as upcoming, then open and overdue after its due-by', async () => {
  const h = await household();
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.car, name: 'Car tax', dayOfMonth: 12, payByDay: 20, amountMinor: 3_000_000 });
  const car = async (on: string) => (await monthlyBills(h.database, h.ws, on)).find((b) => b.name === 'Car tax');
  expect(await car('2026-02-09')).toBeUndefined(); // 31 days to 12 March
  expect(await car('2026-02-10')).toMatchObject({ billMonth: '2026-03', state: 'upcoming' }); // 30 days
  expect(await car('2026-03-15')).toMatchObject({ state: 'open' });
  expect(await car('2026-03-20')).toMatchObject({ state: 'dueSoon', days: 0 });
  expect(await car('2026-03-21')).toMatchObject({ state: 'overdue', days: 1 });
  // April: last month's still-unpaid bill; May: let go until next March.
  expect(await car('2026-04-10')).toMatchObject({ billMonth: '2026-03', state: 'overdue' });
  expect(await car('2026-05-10')).toBeUndefined();
  expect(await car('2026-09-01')).toBeUndefined();
  expect((await dueExpenseTemplates(h.database, h.ws, '2026-06-01')).filter((b) => b.name === 'Car tax')).toEqual([]);
});

it('paying or skipping settles the year: it leaves the list and returns next year', async () => {
  const h = await household();
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-03-01', payments: [{ templateId: h.car, billMonth: '2026-03', amountMinor: 3_100_000 }] });
  expect((await monthlyBills(h.database, h.ws, '2026-03-02')).map((b) => b.name)).toEqual(['Gym']);
  expect((await monthlyBills(h.database, h.ws, '2027-02-20')).find((b) => b.name === 'Car tax')).toMatchObject({ billMonth: '2027-03', state: 'upcoming' });
  // A second payment for the same year is refused.
  await expect(recordBillPayments(h.database, h.ws, { paidOn: '2026-03-02', payments: [{ templateId: h.car, billMonth: '2026-03', amountMinor: 1 }] })).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });

  const h2 = await household();
  await skipBill(h2.database, h2.ws, h2.car, '2026-03');
  expect((await monthlyBills(h2.database, h2.ws, '2026-03-14')).map((b) => b.name)).toEqual(['Gym']);
});

it('stays reachable from yearlyBills all year, with its next occurrence', async () => {
  const h = await household();
  const rows = await yearlyBills(h.database, h.ws, '2026-08-01');
  expect(rows.map((b) => [b.name, b.billMonth, b.window.opensOn])).toEqual([['Car tax', '2027-03', '2027-03-12']]);
  // Paid this year: the next one is next year's.
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-03-01', payments: [{ templateId: h.car, billMonth: '2026-03', amountMinor: 1_000 }] });
  expect((await yearlyBills(h.database, h.ws, '2026-08-01'))[0]).toMatchObject({ billMonth: '2027-03' });
});

it('a bill whose due-by is in the following month: out 28 Dec, pay by 5 Jan', async () => {
  const h = await household();
  const tax = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Insurance', dayOfMonth: 28, payByDay: 5, repeat: 'yearly', repeatMonth: 12, startsMonth: '2026-12', amountMinor: 1_000_000 });
  const row = async (on: string) => (await monthlyBills(h.database, h.ws, on)).find((b) => b.id === tax);
  expect(await row('2026-12-28')).toMatchObject({ billMonth: '2026-12', state: 'open' });
  expect(await row('2027-01-04')).toMatchObject({ billMonth: '2026-12', state: 'dueSoon', days: 1 });
  expect(await row('2027-01-06')).toMatchObject({ billMonth: '2026-12', state: 'overdue', days: 1 });
  expect(await row('2027-02-01')).toBeUndefined();
});

it('a pause over its month skips that occurrence; the month before it does not', async () => {
  const h = await household();
  // Today for the pause is 2026-01-10: pausing until 2026-06 covers March.
  expect(await pauseBill(h.database, h.ws, h.car, '2026-06', '2026-01-10')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  expect((await monthlyBills(h.database, h.ws, '2026-03-10')).map((b) => b.name)).toEqual(['Gym']);
  const detail = await billDetail(h.database, h.ws, h.car, '2026-03-10');
  // The history of a yearly bill is one row a year, not a row for every paused month.
  expect(detail.history.map((r) => [r.month, r.state])).toEqual([['2026-03', 'paused']]);
  // A pause that ends before its month leaves it owed.
  const h2 = await household();
  await pauseBill(h2.database, h2.ws, h2.car, '2026-02', '2026-01-10');
  expect((await monthlyBills(h2.database, h2.ws, '2026-03-10')).map((b) => b.name).sort()).toEqual(['Car tax', 'Gym']);
});

it('counts in the budget commitments only in its month', async () => {
  const h = await household();
  const today = isoDate();
  const month = Number(today.slice(5, 7));
  const commit = async () => (await committedByCategory(h.database, h.ws)).committed[h.category] ?? 0;
  // The gym is monthly, 350k; a yearly bill in this month adds 3m, in any other month nothing.
  const same = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'This month', dayOfMonth: 1, amountMinor: 1_000_000, repeat: 'yearly', repeatMonth: month, startsMonth: today.slice(0, 7) });
  expect(await commit()).toBe(350_000 + 3_000_000 * (month === 3 ? 1 : 0) + 1_000_000);
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: same, name: 'This month', dayOfMonth: 1, amountMinor: 1_000_000, repeat: 'yearly', repeatMonth: (month % 12) + 1 });
  expect(await commit()).toBe(350_000 + 3_000_000 * (month === 3 ? 1 : 0));
});

it('the first month owed is the first occurrence on or after the day it is made', async () => {
  const h = await household();
  const today = isoDate();
  const id = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Domain', dayOfMonth: 15, amountMinor: 200_000, repeat: 'yearly', repeatMonth: 7 });
  expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === id)!.startsMonth).toBe(firstYearlyMonth(today, 7, 15));
});

it('switching between monthly and yearly keeps the bill and its payments, and restarts the schedule', async () => {
  const h = await household();
  const today = isoDate();
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.gym, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, repeat: 'yearly', repeatMonth: 9 });
  let row = (await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.gym)!;
  expect(row).toMatchObject({ repeat: 'yearly', repeatMonth: 9, startsMonth: firstYearlyMonth(today, 9, 5) });
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.gym, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, repeat: 'monthly' });
  row = (await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.gym)!;
  expect(row).toMatchObject({ repeat: 'monthly', repeatMonth: null, startsMonth: today.slice(0, 7) });
  // An edit that does not mention the repeat leaves it.
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.car, name: 'Car tax', dayOfMonth: 12, amountMinor: 4_000_000 });
  expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.car)).toMatchObject({ repeat: 'yearly', repeatMonth: 3, amountMinor: 4_000_000, startsMonth: '2026-03' });
});

it('a 29 February bill falls on the 28th in a common year', async () => {
  const h = await household();
  const leap = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Leap', dayOfMonth: 29, repeat: 'yearly', repeatMonth: 2, startsMonth: '2027-02', amountMinor: 1_000 });
  const row = (await yearlyBills(h.database, h.ws, '2027-01-20')).find((b) => b.id === leap)!;
  expect(row.window).toMatchObject({ opensOn: '2027-02-28' });
  const later = (await yearlyBills(h.database, h.ws, '2027-04-01')).find((b) => b.id === leap)!;
  expect(later.window.opensOn).toBe('2028-02-29');
});

it('a payment made for a yearly bill is attributed like any bill payment', async () => {
  const h = await household();
  await postTransaction(h.database, h.ws, {
    occurredOn: '2026-04-02',
    description: 'Car tax',
    templateId: h.car,
    billMonth: '2026-03',
    lines: expenseLines({ categoryAccountId: h.category, paymentAccountId: h.bank.id, amountMinor: 3_000_000, currency: 'IDR' }),
  });
  expect((await monthlyBills(h.database, h.ws, '2026-04-03')).map((b) => b.name)).toEqual(['Gym']);
  const detail = await billDetail(h.database, h.ws, h.car, '2026-04-03');
  expect(detail.history.map((r) => [r.month, r.state])).toEqual([['2026-03', 'paid']]);
});
