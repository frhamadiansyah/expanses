import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { archiveGoal, createAccount, listAccounts, saveEarmark, saveExpenseTemplate, saveGoal, setAsideTotals, setAsideViews } from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * `setAsideTotals` (fix/partner-set-aside review): the per-account total `setAsideViews` gives, without its balances
 * and share-out, for a joint account's summary. It must be the same figure on every account, short or covered, with a
 * goal archived and a sinking fund saving up. Every name and figure is invented.
 */

let current: TestDb | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-10T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  current?.executor.close();
  current = undefined;
});

const viewTotals = async (t: TestDb, date: string) =>
  Object.fromEntries(
    Object.values(await setAsideViews(t.database, t.ws, { date }))
      .filter((view) => view.setAsideMinor > 0)
      .map((view) => [view.accountId, view.setAsideMinor]),
  );

it('gives each account what setAsideViews sets aside on it, short or covered, archived goals and funds included', async () => {
  current = await setupDb();
  const t = current;
  const { database, ws } = t;
  expect(await setAsideTotals(database, ws, '2026-03-10')).toEqual({});

  const account = (name: string, openingBalanceMinor: number) =>
    createAccount(database, ws, { name, kind: 'asset', subtype: 'savings', currency: 'IDR', openingBalanceMinor, openedOn: '2026-01-01' }).then((a) => a.id);
  const roomy = await account('Tabungan Lapang', 30_000_000);
  const tight = await account('Tabungan Sempit', 2_000_000);
  const spare = await account('Tabungan Cadangan', 9_000_000);
  const goal = (name: string) =>
    saveGoal(database, ws, { name, kind: 'other', growthBps: 0, returnBps: 0, stages: [{ name, targetMinor: 50_000_000, targetMonths: null, dueOn: '2030-06-01' }] });
  const first = await goal('Renovasi Dapur');
  const second = await goal('Sepeda Baru');
  const gone = await goal('Kamera Lama');
  await saveEarmark(database, ws, { goalId: first, accountId: roomy, amountMinor: 7_000_000 });
  await saveEarmark(database, ws, { goalId: second, accountId: roomy, amountMinor: 1_500_000 });
  // More promised than it holds: the total is what is promised, as the holder's Wallet takes off.
  await saveEarmark(database, ws, { goalId: first, accountId: tight, amountMinor: 3_200_000 });
  await saveEarmark(database, ws, { goalId: gone, accountId: spare, amountMinor: 4_000_000 });
  await archiveGoal(database, ws, gone);
  const category = (await listAccounts(database, ws)).find((a) => a.systemKey === 'personal_care.sports_fitness')!.id;
  await saveExpenseTemplate(database, ws, {
    categoryAccountId: category,
    moneyAccountId: spare,
    name: 'Pajak Kendaraan',
    dayOfMonth: 12,
    amountMinor: 2_400_000,
    repeat: 'yearly',
    repeatMonth: 9,
    fund: { accountId: spare },
  });

  for (const date of ['2026-03-10', '2026-06-20']) {
    const totals = await setAsideTotals(database, ws, date);
    expect(totals).toEqual(await viewTotals(t, date));
    expect(totals[roomy]).toBe(8_500_000);
    expect(totals[tight]).toBe(3_200_000);
  }
  // The fund grows with the months; the archived goal counts nothing.
  expect((await setAsideTotals(database, ws, '2026-06-20'))[spare]).toBeGreaterThan((await setAsideTotals(database, ws, '2026-03-10'))[spare] ?? 0);
});
