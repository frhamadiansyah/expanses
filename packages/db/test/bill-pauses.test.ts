import { addMonths, expenseLines, isoDate, monthOf } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import { billDetail, committedByCategory, createAccount, listAccounts, monthlyBills, pauseBill, postTransaction, resumeBill, saveExpenseTemplate } from '../src/index';
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
  const gymCategory = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const gym = await saveExpenseTemplate(database, ws, { name: 'Gym', categoryAccountId: gymCategory, moneyAccountId: bank.id, dayOfMonth: 5, amountMinor: 350_000, startsMonth: '2026-09' });
  return { database, ws, bank, gym, gymCategory };
}

it('stores one row per paused month, from this month up to the month it comes back', async () => {
  const h = await household();
  expect(await pauseBill(h.database, h.ws, h.gym, '2026-12', '2026-10-01')).toEqual(['2026-10', '2026-11']);
  expect(await h.database.db.values(sql`SELECT template_id, month FROM bill_pauses ORDER BY month`)).toEqual([
    [h.gym, '2026-10'],
    [h.gym, '2026-11'],
  ]);
  // Pausing again over the same months changes nothing.
  await pauseBill(h.database, h.ws, h.gym, '2026-12', '2026-10-01');
  expect(await h.database.db.values(sql`SELECT count(*) FROM bill_pauses`)).toEqual([[2]]);
  await expect(pauseBill(h.database, h.ws, h.gym, '2026-10', '2026-10-01')).rejects.toMatchObject({ code: 'PAUSE_RANGE' });
});

it('a paused month is neither due nor late, comes back by itself, and shows in the history', async () => {
  const h = await household();
  // September is paid, so the pause starts in October.
  await postTransaction(h.database, h.ws, {
    occurredOn: '2026-09-05',
    description: 'Gym',
    templateId: h.gym,
    billMonth: '2026-09',
    lines: expenseLines({ categoryAccountId: h.gymCategory, paymentAccountId: h.bank.id, amountMinor: 350_000, currency: 'IDR' }),
  });
  await pauseBill(h.database, h.ws, h.gym, '2026-12', '2026-10-01');

  expect((await monthlyBills(h.database, h.ws, '2026-10-20'))[0]).toMatchObject({ billMonth: '2026-10', state: 'paused', pausedUntil: '2026-12' });
  // November still paused; October's paused month does not hold the row back as unpaid.
  expect((await monthlyBills(h.database, h.ws, '2026-11-20'))[0]).toMatchObject({ billMonth: '2026-11', state: 'paused', pausedUntil: '2026-12' });
  // December: back, and owed, with no job to clear the pause.
  expect((await monthlyBills(h.database, h.ws, '2026-12-20'))[0]).toMatchObject({ billMonth: '2026-12', state: 'overdue', pausedUntil: null });

  const detail = await billDetail(h.database, h.ws, h.gym, '2026-10-02');
  expect(detail.history.map((row) => [row.month, row.state])).toEqual([
    ['2026-11', 'paused'],
    ['2026-10', 'paused'],
    ['2026-09', 'paid'],
  ]);
  // A paused month can still be paid on purpose: it is offered, after any month that is owed.
  expect(detail.bill.payableMonths).toEqual(['2026-10', '2026-11']);
});

it('resume takes back the paused months from today on, and keeps the earlier ones', async () => {
  const h = await household();
  await pauseBill(h.database, h.ws, h.gym, '2027-01', '2026-10-01');
  await resumeBill(h.database, h.ws, h.gym, '2026-11-10');
  expect(await h.database.db.values(sql`SELECT month FROM bill_pauses`)).toEqual([['2026-10']]);
  expect((await monthlyBills(h.database, h.ws, '2026-11-10'))[0]).toMatchObject({ billMonth: '2026-11', state: 'overdue', pausedUntil: null });
});

it('a bill paused this month commits nothing to its category’s budget', async () => {
  const h = await household();
  const today = isoDate();
  expect((await committedByCategory(h.database, h.ws)).committed).toEqual({ [h.gymCategory]: 350_000 });
  await pauseBill(h.database, h.ws, h.gym, addMonths(monthOf(today), 2), today);
  expect((await committedByCategory(h.database, h.ws)).committed).toEqual({});
});
