import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createAccount, LedgerError, listAccounts, listTransactions, moveTransactionInDay, postTransaction, replaceTransaction } from '../src/index';
import { setupDb } from './helpers';

/* Rows moved by hand within their day (migration 0067): the order rule, one write per drag, and a date change. */

const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

async function setup() {
  const t = await setupDb();
  const bank = (await createAccount(t.database, t.ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' })).id;
  const groceries = (await listAccounts(t.database, t.ws)).find((a) => a.name === 'Groceries')!.id;
  const spend = async (description: string, occurredOn = '2026-10-14') => {
    await pause();
    return postTransaction(t.database, t.ws, {
      occurredOn,
      description,
      lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 10_000, currency: 'IDR' }),
    });
  };
  const day = async (occurredOn = '2026-10-14') =>
    (await listTransactions(t.database, t.ws, { from: occurredOn, to: occurredOn })).map((tx) => tx.description);
  const orders = async () =>
    Object.fromEntries(
      (await t.database.db.values<[string, number | null]>(sql`SELECT description, day_order FROM transactions WHERE status = 'posted' AND occurred_on = '2026-10-14'`)).map(
        ([d, o]) => [d, o === null ? null : Number(o)],
      ),
    );
  return { ...t, bank, groceries, spend, day, orders };
}

describe('moving a transaction within its day', () => {
  it('keeps a row where it was dropped, and a new row still lands on top of its day', async () => {
    const { database, ws, spend, day, orders } = await setup();
    const a = await spend('A');
    const b = await spend('B');
    const c = await spend('C');
    expect(await day()).toEqual(['C', 'B', 'A']);

    // A to the top: its neighbour was never placed, so the day is numbered once.
    await moveTransactionInDay(database, ws, a, [a, c, b]);
    expect(await day()).toEqual(['A', 'C', 'B']);
    expect(await orders()).toEqual({ A: 1, C: 2, B: 3 });

    // A new transaction is unplaced: it goes on top of the placed ones.
    await spend('D');
    expect(await day()).toEqual(['D', 'A', 'C', 'B']);
    expect((await listTransactions(database, ws)).find((tx) => tx.description === 'A')?.dayOrder).toBe(1);
  });

  it('writes the moved row alone when both neighbours are placed', async () => {
    const { database, ws, spend, day, orders } = await setup();
    const a = await spend('A');
    const b = await spend('B');
    const c = await spend('C');
    await moveTransactionInDay(database, ws, a, [a, c, b]);
    const before = await database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'reorder'`);

    await moveTransactionInDay(database, ws, b, [a, b, c]);
    expect(await day()).toEqual(['A', 'B', 'C']);
    expect(await orders()).toEqual({ A: 1, B: 1.5, C: 2 });
    const after = await database.db.values<[number]>(sql`SELECT count(*) FROM audit_log WHERE action = 'reorder'`);
    expect(Number(after[0]![0]) - Number(before[0]![0])).toBe(1);

    // Dropped where it already was: nothing written.
    await moveTransactionInDay(database, ws, b, [a, b, c]);
    expect(await orders()).toEqual({ A: 1, B: 1.5, C: 2 });
  });

  it('an edit keeps the place on the same day; a new date clears it, to the top of the new day', async () => {
    const { database, ws, bank, groceries, spend, day } = await setup();
    const a = await spend('A');
    const b = await spend('B');
    const c = await spend('C');
    await spend('Next day', '2026-10-15');
    await moveTransactionInDay(database, ws, a, [b, a, c]);
    expect(await day()).toEqual(['B', 'A', 'C']);

    const lines = expenseLines({ categoryAccountId: groceries, paymentAccountId: bank, amountMinor: 12_000, currency: 'IDR' });
    await pause();
    await replaceTransaction(database, ws, a, { occurredOn: '2026-10-14', description: 'A edited', lines });
    expect(await day()).toEqual(['B', 'A edited', 'C']);

    await pause();
    const moved = await replaceTransaction(database, ws, b, { occurredOn: '2026-10-15', description: 'B', lines });
    expect(await day()).toEqual(['A edited', 'C']);
    expect(await day('2026-10-15')).toEqual(['B', 'Next day']);
    const [row] = await database.db.values<[number | null]>(sql`SELECT day_order FROM transactions WHERE id = ${moved}`);
    expect(row![0]).toBeNull();
  });

  it('orders the list the same way across days: newest day first, each day in its own order', async () => {
    const { database, ws, spend } = await setup();
    const a = await spend('A');
    const b = await spend('B');
    await spend('Later', '2026-10-20');
    await spend('Earlier', '2026-10-01');
    await moveTransactionInDay(database, ws, a, [a, b]);
    expect((await listTransactions(database, ws)).filter((tx) => tx.description !== 'Opening balance').map((tx) => tx.description)).toEqual(['Later', 'A', 'B', 'Earlier']);
  });

  it('refuses a row from another day, and one not in the order it is given', async () => {
    const { database, ws, spend } = await setup();
    const a = await spend('A');
    const b = await spend('B');
    const other = await spend('Other', '2026-10-15');
    await expect(moveTransactionInDay(database, ws, a, [a, other, b])).rejects.toBeInstanceOf(LedgerError);
    await expect(moveTransactionInDay(database, ws, a, [b])).rejects.toBeInstanceOf(LedgerError);
  });
});
