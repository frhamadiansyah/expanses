import { nextOccurrenceMonth, isoDate } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import {
  billDetail,
  committedByCategory,
  createAccount,
  listAccounts,
  listExpenseTemplates,
  monthlyBills,
  pauseBill,
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
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 10_000_000, openedOn: '2026-01-01' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bank.id };
  const gym = await saveExpenseTemplate(database, ws, { ...base, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, startsMonth: '2026-01' });
  const yearly = await saveExpenseTemplate(database, ws, { ...base, name: 'Car tax', dayOfMonth: 12, amountMinor: 3_000_000, repeat: 'yearly', repeatMonth: 3, startsMonth: '2026-03' });
  // Every 3 months from August 2026: Aug, Nov, Feb, May.
  const water = await saveExpenseTemplate(database, ws, {
    ...base,
    name: 'Water',
    dayOfMonth: 12,
    amountMinor: 300_000,
    repeat: 'months',
    repeatMonth: 8,
    repeatEvery: 3,
    startsMonth: '2026-08',
  });
  return { database, ws, bank, category, base, gym, yearly, water };
}

type H = Awaited<ReturnType<typeof household>>;
const names = async (h: H, on: string) => (await monthlyBills(h.database, h.ws, on)).map((b) => b.name).sort();
const water = async (h: H, on: string) => (await monthlyBills(h.database, h.ws, on)).find((b) => b.id === h.water);

it('stores repeat, month and gap by name, and reads them back', async () => {
  const h = await household();
  const rows = await listExpenseTemplates(h.database, h.ws);
  expect(rows.find((r) => r.id === h.water)).toMatchObject({ repeat: 'months', repeatMonth: 8, repeatEvery: 3 });
  expect(rows.find((r) => r.id === h.yearly)).toMatchObject({ repeat: 'yearly', repeatMonth: 3, repeatEvery: null });
  expect(rows.find((r) => r.id === h.gym)).toMatchObject({ repeat: 'monthly', repeatMonth: null, repeatEvery: null });
  expect(await h.database.db.values(sql`SELECT repeat, repeat_month, repeat_every FROM expense_templates WHERE id = ${h.water}`)).toEqual([['months', 8, 3]]);
});

it('needs a starting month and a gap from 2 to 11', async () => {
  const h = await household();
  const bad = (extra: object) => saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'X', dayOfMonth: 1, repeat: 'months', ...extra });
  await expect(bad({ repeatEvery: 3 })).rejects.toMatchObject({ code: 'MONTH_REQUIRED' });
  await expect(bad({ repeatMonth: 4 })).rejects.toMatchObject({ code: 'EVERY_RANGE' });
  await expect(bad({ repeatMonth: 4, repeatEvery: 1 })).rejects.toMatchObject({ code: 'EVERY_RANGE' });
  await expect(bad({ repeatMonth: 4, repeatEvery: 12 })).rejects.toMatchObject({ code: 'EVERY_RANGE' });
});

it('is listed 30 days ahead, when out and unpaid, and not in between', async () => {
  const h = await household();
  expect(await names(h, '2026-07-12')).toEqual(['Gym']); // 31 days to 12 Aug
  expect(await water(h, '2026-07-13')).toMatchObject({ billMonth: '2026-08', state: 'upcoming' });
  expect(await water(h, '2026-08-12')).toMatchObject({ state: 'dueSoon', days: 0 });
  expect(await water(h, '2026-09-05')).toMatchObject({ billMonth: '2026-08', state: 'overdue' }); // late, still listed
  expect(await water(h, '2026-10-01')).toBeUndefined();
  expect(await water(h, '2026-10-12')).toBeUndefined(); // 31 days to 12 Nov
  expect(await water(h, '2026-10-13')).toMatchObject({ billMonth: '2026-11', state: 'upcoming' });
  // Over the year end: November, then February.
  expect(await water(h, '2027-01-13')).toMatchObject({ billMonth: '2027-02' });
  expect(await water(h, '2027-01-05')).toBeUndefined();
});

it('paying or skipping settles an occurrence and the next one is three months on', async () => {
  const h = await household();
  await recordBillPayments(h.database, h.ws, { paidOn: '2026-08-10', payments: [{ templateId: h.water, billMonth: '2026-08', amountMinor: 310_000 }] });
  expect(await water(h, '2026-08-20')).toBeUndefined();
  expect(await water(h, '2026-10-20')).toMatchObject({ billMonth: '2026-11', state: 'upcoming' });
  await expect(recordBillPayments(h.database, h.ws, { paidOn: '2026-08-11', payments: [{ templateId: h.water, billMonth: '2026-08', amountMinor: 1 }] })).rejects.toMatchObject({ code: 'ALREADY_SETTLED' });

  const h2 = await household();
  await skipBill(h2.database, h2.ws, h2.water, '2026-08');
  expect(await water(h2, '2026-08-20')).toBeUndefined();
  expect(await water(h2, '2026-10-20')).toMatchObject({ billMonth: '2026-11' });
});

it('a pause over an occurrence skips it, and the history has one row per occurrence', async () => {
  const h = await household();
  expect(await pauseBill(h.database, h.ws, h.water, '2026-10', '2026-08-01')).toEqual(['2026-08', '2026-09']);
  expect(await water(h, '2026-08-20')).toBeUndefined();
  const detail = await billDetail(h.database, h.ws, h.water, '2026-12-01');
  expect(detail.history.map((r) => [r.month, r.state])).toEqual([
    ['2026-11', 'overdue'],
    ['2026-08', 'paused'],
  ]);
});

it('the history of an unpaid new bill is only its due occurrences, none before it began', async () => {
  const h = await household();
  const detail = await billDetail(h.database, h.ws, h.water, '2026-07-01');
  expect(detail.history).toEqual([]);
});

it('counts in budget commitments only in a month it is owed', async () => {
  const h = await household();
  const today = isoDate();
  const commit = async () => (await committedByCategory(h.database, h.ws)).committed[h.category] ?? 0;
  const start = today.slice(0, 7);
  const month = Number(today.slice(5, 7));
  const mine = await saveExpenseTemplate(h.database, h.ws, {
    ...h.base,
    name: 'Now',
    dayOfMonth: 1,
    amountMinor: 1_000_000,
    repeat: 'months',
    repeatMonth: month,
    repeatEvery: 4,
    startsMonth: start,
  });
  const others = 350_000 + (month === 3 ? 3_000_000 : 0) + ((month - 8 + 12) % 3 === 0 && today >= '2026-08' ? 300_000 : 0);
  expect(await commit()).toBe(others + 1_000_000);
  // Next month it is not owed (gap 4).
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: mine, name: 'Now', dayOfMonth: 1, amountMinor: 1_000_000, repeat: 'months', repeatMonth: (month % 12) + 1, repeatEvery: 4 });
  expect(await commit()).toBe(others);
});

it('the first month owed is the first occurrence on or after the day it is made', async () => {
  const h = await household();
  const id = await saveExpenseTemplate(h.database, h.ws, { ...h.base, name: 'Domain', dayOfMonth: 15, amountMinor: 200_000, repeat: 'months', repeatMonth: 7, repeatEvery: 2 });
  expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === id)!.startsMonth).toBe(nextOccurrenceMonth(isoDate(), 7, 15));
});

it('switching between monthly, yearly and every few months restarts the schedule; other edits leave it', async () => {
  const h = await household();
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.gym, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, repeat: 'months', repeatMonth: 9, repeatEvery: 2 });
  let row = (await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.gym)!;
  expect(row).toMatchObject({ repeat: 'months', repeatMonth: 9, repeatEvery: 2, startsMonth: nextOccurrenceMonth(isoDate(), 9, 5) });
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.gym, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, repeat: 'yearly', repeatMonth: 9 });
  row = (await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.gym)!;
  expect(row).toMatchObject({ repeat: 'yearly', repeatMonth: 9, repeatEvery: null });
  expect(await h.database.db.values(sql`SELECT repeat_every FROM expense_templates WHERE id = ${h.gym}`)).toEqual([[null]]);
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.gym, name: 'Gym', dayOfMonth: 5, amountMinor: 350_000, repeat: 'monthly' });
  expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.gym)).toMatchObject({ repeat: 'monthly', repeatMonth: null, repeatEvery: null });
  // An edit that does not mention the repeat leaves it, and its first month.
  await saveExpenseTemplate(h.database, h.ws, { ...h.base, id: h.water, name: 'Water', dayOfMonth: 12, amountMinor: 400_000 });
  expect((await listExpenseTemplates(h.database, h.ws)).find((r) => r.id === h.water)).toMatchObject({ repeat: 'months', repeatMonth: 8, repeatEvery: 3, amountMinor: 400_000, startsMonth: '2026-08' });
});

it('yearlyBills lists every non-monthly bill all year, yearly and periodic', async () => {
  const h = await household();
  const rows = await yearlyBills(h.database, h.ws, '2026-10-20');
  expect(rows.map((b) => [b.name, b.billMonth])).toEqual([
    ['Water', '2026-11'],
    ['Car tax', '2027-03'],
  ]);
});

it('a monthly and a yearly bill are unchanged beside a periodic one', async () => {
  const h = await household();
  expect(await names(h, '2026-03-14')).toEqual(['Car tax', 'Gym']);
  expect(await names(h, '2026-06-20')).toEqual(['Gym']);
});

it('a sinking fund for an every-few-months bill saves toward the next occurrence', async () => {
  const h = await household();
  const fund = await saveExpenseTemplate(h.database, h.ws, {
    ...h.base,
    id: h.water,
    name: 'Water',
    dayOfMonth: 12,
    amountMinor: 300_000,
    repeat: 'months',
    repeatMonth: 8,
    repeatEvery: 3,
    fund: { accountId: h.bank.id },
  });
  expect(fund).toBe(h.water);
  const rows = await h.database.db.values<[number]>(sql`SELECT monthly_minor FROM sinking_funds WHERE bill_id = ${h.water}`);
  expect(rows).toHaveLength(1);
});
