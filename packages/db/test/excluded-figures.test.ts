import { expenseLines, monthRange } from '@expanses/core';
import { afterEach, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
  eventPlanFor,
  eventSpendingBetween,
  listAccounts,
  nativeBalances,
  periodFlows,
  postTransaction,
  saveEvent,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

async function month() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createAccount(database, ws, { name: 'BCA Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const electronics = all.find((a) => a.systemKey === 'shopping.electronics')!.id;
  const groceries = all.find((a) => a.systemKey === 'household.groceries')!.id;
  const spend = (categoryAccountId: string, amountMinor: number, extra = {}) =>
    postTransaction(database, ws, {
      occurredOn: '2026-09-17',
      description: 'A purchase',
      lines: expenseLines({ categoryAccountId, paymentAccountId: card.id, amountMinor, currency: 'IDR' }),
      ...extra,
    });
  return { database, ws, card, electronics, groceries, spend };
}

it('leaves the category totals the chart and the budget are built on', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000, { excludedFromReport: true });
  const { from, to } = monthRange('2026-09');

  const totals = await categoryTotalsIn(m.database, m.ws, 'expense', from, to);
  expect(totals.rows.map((row) => [row.accountId, row.amountBaseMinor])).toEqual([[m.groceries, 250_000]]);
});

it('leaves what the month says was spent, but not what the card owes', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000, { excludedFromReport: true });

  const flows = await periodFlows(m.database, m.ws, { from: '2026-09-01', to: '2026-09-30' });
  expect(flows.spendingMinor).toBe(250_000);
  // The purchase really happened on the card: the balance, and so the statement and net worth, still hold it.
  expect((await nativeBalances(m.database, m.ws))[m.card.id]).toBe(-19_249_000);
});

it('still counts one when nothing was excluded, so no figure moves for anybody else', async () => {
  const m = await month();
  await m.spend(m.groceries, 250_000);
  await m.spend(m.electronics, 18_999_000);
  const { from, to } = monthRange('2026-09');

  const totals = await categoryTotalsIn(m.database, m.ws, 'expense', from, to);
  expect(totals.rows.reduce((sum, row) => sum + row.amountBaseMinor, 0)).toBe(19_249_000);
});

it('leaves the event what it spent, and what the plan says it bought', async () => {
  const m = await month();
  const eventId = await saveEvent(m.database, m.ws, { name: 'Bali holiday', startsOn: '2026-09-01', endsOn: '2026-09-30' });
  await m.spend(m.groceries, 250_000, { eventId });
  await m.spend(m.electronics, 18_999_000, { eventId, excludedFromReport: true });

  expect((await eventSpendingBetween(m.database, m.ws, '2026-09-01', '2026-09-30')).amountMinor).toBe(250_000);
  // The same figure on the event's own screen: the plan's Spent and the category report must agree, so they drop
  // the same rows. `eventPlanFor` is what `eventSheetFor` became; spec §11's last-but-one row is about this one.
  expect((await eventPlanFor(m.database, m.ws, eventId)).spentMinor).toBe(250_000);
});
