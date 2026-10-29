import { formatMinor } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createAccount,
  deleteExpenseTemplate,
  listAccounts,
  listExpenseTemplates,
  listSinkingFunds,
  putInSinkingExtra,
  recordBillPayments,
  saveEarmark,
  saveExpenseTemplate,
  saveGoal,
  setAsideView,
  setSinkingMonthSkipped,
  sinkingFundOf,
  sinkingHistoryOf,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  current?.executor.close();
  current = undefined;
});

const idr = (minor: number) => formatMinor(minor, 'IDR');

/** Jenius holds 1.000.000: a goal takes 400.000 and another fund 109.091, so 490.909 is free. */
async function house() {
  current = await setupDb();
  const { database, ws } = current;
  const jenius = await createAccount(database, ws, { name: 'Jenius', kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor: 1_000_000, openedOn: '2026-01-01' });
  const bank = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 5_000_000, openedOn: '2026-01-01' });
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  const base = { categoryAccountId: category, moneyAccountId: bank.id };
  const goalId = await saveGoal(database, ws, { name: 'Umrah', kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name: 'Umrah', targetMinor: 1_000_000, targetMonths: null, dueOn: '2027-12-31' }] });
  await saveEarmark(database, ws, { goalId, accountId: jenius.id, amountMinor: 400_000 });
  const insurance = await saveExpenseTemplate(database, ws, { ...base, name: 'Insurance', dayOfMonth: 12, amountMinor: 1_200_000, repeat: 'yearly', repeatMonth: 9, fund: { accountId: jenius.id } });
  const land = (fund: Parameters<typeof saveExpenseTemplate>[2]['fund'], extra: object = {}) =>
    saveExpenseTemplate(database, ws, { ...base, name: 'Land tax', dayOfMonth: 10, amountMinor: 612_385, repeat: 'yearly', repeatMonth: 4, fund, ...extra });
  return { database, ws, jenius, bank, base, insurance, land };
}
type House = Awaited<ReturnType<typeof house>>;
const entryCount = async (h: House) => Number((await h.database.db.values<[number]>(sql`SELECT COUNT(*) FROM sinking_fund_entries`))[0]![0]);

it('the room first: another fund and a goal leave 490.909 free', async () => {
  const h = await house();
  expect(await sinkingFundOf(h.database, h.ws, h.insurance)).toMatchObject({ monthlyMinor: 109_091, savedMinor: 109_091 });
  expect((await setAsideView(h.database, h.ws, h.jenius.id, { date: '2026-10-10' }))?.freeMinor).toBe(490_909);
});

it('saves with Already saved: it counts before the monthly figure is worked out', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id, alreadySavedMinor: 100_000 });
  const view = (await sinkingFundOf(h.database, h.ws, id))!;
  // (612.385 - 100.000) / 6 months = 85.397,5 -> 85.398
  expect(view).toMatchObject({ monthlyMinor: 85_398, savedMinor: 185_398, monthsDone: 1, monthsTotal: 6, custom: false });
  expect(view.entries.map((e) => [e.kind, e.amountMinor])).toEqual([['opening', 100_000]]);
});

it('refuses at save time when the account has too little free money, and the bill is not saved', async () => {
  const h = await house();
  await expect(h.land({ accountId: h.jenius.id, alreadySavedMinor: 480_000 })).rejects.toMatchObject({
    code: 'FUND_SHORT',
    // (612.385 - 480.000) / 6 = 22.064,2 -> 22.065; 480.000 + 22.065 = 502.065 is more than the 490.909 free.
    message: `Jenius has ${idr(490_909)} free. This fund needs ${idr(502_065)} now.`,
  });
  expect((await listExpenseTemplates(h.database, h.ws)).map((b) => b.name)).toEqual(['Insurance']);
  expect(await listSinkingFunds(h.database.db, h.ws)).toHaveLength(1);
  // The same fund fits in the other account.
  await expect(h.land({ accountId: h.bank.id, alreadySavedMinor: 480_000 })).resolves.toBeTruthy();
});

it('an unrelated edit of a fund is not blocked when the account is already short', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id });
  // Nothing new is promised by a rename, so the free-money check does not run.
  await expect(h.land({ accountId: h.jenius.id }, { id, name: 'Land tax (renamed)' })).resolves.toBe(id);
});

it('put in extra: refused above the free money, allowed within it', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id });
  // 490.909 - 102.065 = 388.844 is free now.
  await expect(putInSinkingExtra(h.database, h.ws, id, { amountMinor: 400_000 })).rejects.toMatchObject({ code: 'FUND_SHORT', message: `Jenius has ${idr(388_844)} free. This fund needs ${idr(400_000)} now.` });
  expect((await sinkingFundOf(h.database, h.ws, id))!.entries).toEqual([]);
  await putInSinkingExtra(h.database, h.ws, id, { amountMinor: 100_000, date: '2026-10-10' });
  expect((await sinkingFundOf(h.database, h.ws, id))!.savedMinor).toBe(202_065);
});

it('put in extra recalculates the monthly figure from next month; the switch keeps the old one', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id });
  await putInSinkingExtra(h.database, h.ws, id, { amountMinor: 100_000 });
  // 612.385 - 202.065 = 410.320 over the 5 months November to March = 82.064.
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ savedMinor: 202_065, monthlyMinor: 82_064, custom: false });
  vi.setSystemTime(new Date('2026-11-05T12:00:00'));
  expect((await sinkingFundOf(h.database, h.ws, id))!.savedMinor).toBe(202_065 + 82_064);

  vi.setSystemTime(new Date('2026-10-10T12:00:00'));
  const kept = await h.land({ accountId: h.jenius.id }, { name: 'Land tax kept' });
  await putInSinkingExtra(h.database, h.ws, kept, { amountMinor: 100_000, keepMonthly: true });
  expect(await sinkingFundOf(h.database, h.ws, kept)).toMatchObject({ monthlyMinor: 102_065, custom: true });
  vi.setSystemTime(new Date('2026-11-05T12:00:00'));
  expect((await sinkingFundOf(h.database, h.ws, kept))!.savedMinor).toBe(100_000 + 2 * 102_065);
});

it('skipping a month changes Saved and the monthly figure; adding it again restores it', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id });
  vi.setSystemTime(new Date('2026-11-05T12:00:00'));
  expect((await sinkingFundOf(h.database, h.ws, id))!.savedMinor).toBe(204_130);
  await setSinkingMonthSkipped(h.database, h.ws, id, '2026-11', true);
  // The owner's numbers: 510.320 over 4 months = 127.580.
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ savedMinor: 102_065, monthlyMinor: 127_580 });
  vi.setSystemTime(new Date('2026-12-02T12:00:00'));
  expect((await sinkingFundOf(h.database, h.ws, id))!.savedMinor).toBe(102_065 + 127_580);
  vi.setSystemTime(new Date('2026-11-05T12:00:00'));
  await setSinkingMonthSkipped(h.database, h.ws, id, '2026-11', false);
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ savedMinor: 204_130, monthlyMinor: 102_064 });
  await expect(setSinkingMonthSkipped(h.database, h.ws, id, '2026-12', true)).rejects.toMatchObject({ code: 'FUND_MONTH' });
});

it('a typed monthly figure is kept through a skip', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id, monthlyMinor: 90_000 });
  vi.setSystemTime(new Date('2026-11-05T12:00:00'));
  await setSinkingMonthSkipped(h.database, h.ws, id, '2026-11', true);
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ savedMinor: 90_000, monthlyMinor: 90_000, custom: true });
});

it('the history lists the newest first, with the current month marked and skipped months shown', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id, alreadySavedMinor: 100_000 });
  vi.setSystemTime(new Date('2026-11-12T12:00:00'));
  await putInSinkingExtra(h.database, h.ws, id, { amountMinor: 50_000, date: '2026-11-12' });
  await setSinkingMonthSkipped(h.database, h.ws, id, '2026-10', true);
  const history = (await sinkingHistoryOf(h.database, h.ws, id))!;
  expect(history.rows.map((r) => [r.kind, r.date, r.skipped, r.current])).toEqual([
    ['extra', '2026-11-12', false, false],
    ['month', '2026-11', false, true],
    ['month', '2026-10', true, false],
    ['opening', '2026-10-10', false, false],
  ]);
  expect(history.rows[0]).toMatchObject({ amountMinor: 50_000 });
  expect(history.rows[1]).toMatchObject({ index: 2, monthsTotal: 6 });
});

it('a fund made under 0101 (extra_minor on the row, no entries) still reads and still takes new entries', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id });
  await h.database.db.run(sql`DELETE FROM sinking_fund_entries WHERE bill_id = ${id}`);
  await h.database.db.run(sql`UPDATE sinking_funds SET extra_minor = 50000, monthly_custom = 0 WHERE bill_id = ${id}`);
  const view = (await sinkingFundOf(h.database, h.ws, id))!;
  expect(view.savedMinor).toBe(102_065 + 50_000);
  expect(view.legacyExtraMinor).toBe(50_000);
  expect(view.entries.map((e) => [e.id, e.kind, e.amountMinor])).toEqual([['legacy-extra', 'extra', 50_000]]);
  expect((await sinkingHistoryOf(h.database, h.ws, id))!.rows.map((r) => r.kind)).toEqual(['extra', 'month']);
  await putInSinkingExtra(h.database, h.ws, id, { amountMinor: 10_000 });
  expect((await sinkingFundOf(h.database, h.ws, id))!.savedMinor).toBe(102_065 + 60_000);
});

it('editing the form: the monthly figure typed changes from this month, the months before keep theirs', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.bank.id });
  vi.setSystemTime(new Date('2026-12-02T12:00:00'));
  await h.land({ accountId: h.bank.id, monthlyMinor: 150_000 }, { id });
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ savedMinor: 2 * 102_065 + 150_000, monthlyMinor: 150_000, custom: true });
  // Clearing the typed figure works it out again: 612.385 - 204.130 = 408.255 over the 4 months December to March.
  await h.land({ accountId: h.bank.id, monthlyMinor: null }, { id });
  expect(await sinkingFundOf(h.database, h.ws, id)).toMatchObject({ monthlyMinor: 102_064, custom: false });
});

it('turning the fund off, deleting the bill or paying it releases the fund and its entries', async () => {
  const h = await house();
  const id = await h.land({ accountId: h.jenius.id, alreadySavedMinor: 100_000 });
  await putInSinkingExtra(h.database, h.ws, id, { amountMinor: 10_000 });
  expect(await entryCount(h)).toBeGreaterThan(0);
  await h.land(null, { id });
  expect(await sinkingFundOf(h.database, h.ws, id)).toBeNull();
  // Insurance has entries? Only its own plan, none yet.
  const second = await h.land({ accountId: h.jenius.id, alreadySavedMinor: 100_000 }, { name: 'Tax 2' });
  await deleteExpenseTemplate(h.database, h.ws, second);
  expect(await entryCount(h)).toBe(0);

  const third = await h.land({ accountId: h.jenius.id, alreadySavedMinor: 100_000 }, { name: 'Tax 3' });
  expect(await entryCount(h)).toBeGreaterThan(0);
  vi.setSystemTime(new Date('2027-04-10T12:00:00'));
  await recordBillPayments(h.database, h.ws, { paidOn: '2027-04-10', payments: [{ templateId: third, billMonth: '2027-04', amountMinor: 612_385, moneyAccountId: h.bank.id }] });
  expect((await listSinkingFunds(h.database.db, h.ws)).map((f) => f.billId)).not.toContain(third);
  expect(await entryCount(h)).toBe(0);
});
