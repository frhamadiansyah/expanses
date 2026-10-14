import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listTransactions, moveTransactionInDay, postTransaction, replaceTransaction } from '../../src/index';
import { applyChangeSet } from '../../src/sync/apply';
import { encodeHlc } from '../../src/sync/hlc';
import { categoryOf, type Device, Household } from './household';

/* A shared purchase's place within its day (0067) travels as the purchase's `dayOrder`, written in place on arrival. */

const DAY = '2026-10-14';
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

async function spend(d: Device, bookId: string, description: string, occurredOn = DAY): Promise<string> {
  await pause();
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn,
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor: 10_000, currency: 'IDR' }),
  });
}

const day = async (d: Device) => (await listTransactions(d.database, d.ws, { from: DAY, to: DAY })).map((tx) => tx.description);

async function outboxOps(d: Device): Promise<{ entity: string; id: string; fields: Record<string, unknown> }[]> {
  const rows = await d.database.db.values<[string]>(sql`SELECT entry_json FROM sync_outbox ORDER BY rowid`);
  return rows.flatMap(([json]) => (JSON.parse(json) as { ops: { entity: string; id: string; fields: Record<string, unknown> }[] }).ops);
}

describe('a purchase moved within its day, shared', () => {
  it('sends the moved row alone and lands in place on the partner’s phone, no repost', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    const a = await spend(fandri, bookId, 'A');
    const b = await spend(fandri, bookId, 'B');
    const c = await spend(fandri, bookId, 'C');
    await home.settle();
    expect(await day(dewi)).toEqual(['C', 'B', 'A']);

    // Numbered once (its neighbour was never placed), then a second move between two placed rows: one row.
    await moveTransactionInDay(fandri.database, fandri.ws, a, [a, c, b]);
    await home.settle();
    expect(await day(dewi)).toEqual(['A', 'C', 'B']);
    const heads = async () => (await dewi.database.db.values<[string]>(sql`SELECT id FROM transactions WHERE status = 'posted' ORDER BY id`)).map(([id]) => id);
    const before = await heads();

    await moveTransactionInDay(fandri.database, fandri.ws, b, [a, b, c]);
    const sent = (await outboxOps(fandri)).filter((op) => op.entity === 'purchase');
    expect(sent.at(-1)).toEqual({ entity: 'purchase', id: b, op: 'upsert', fields: { dayOrder: 1.5 } });
    await home.settle();
    expect(await day(dewi)).toEqual(['A', 'B', 'C']);
    // Written in place: the same rows are posted as before, none voided and reposted.
    expect(await heads()).toEqual(before);

    // And Dewi's move comes back the same way.
    const dewiC = (await listTransactions(dewi.database, dewi.ws, { from: DAY, to: DAY })).find((tx) => tx.description === 'C')!.id;
    const dewiA = (await listTransactions(dewi.database, dewi.ws, { from: DAY, to: DAY })).find((tx) => tx.description === 'A')!.id;
    const dewiB = (await listTransactions(dewi.database, dewi.ws, { from: DAY, to: DAY })).find((tx) => tx.description === 'B')!.id;
    await moveTransactionInDay(dewi.database, dewi.ws, dewiC, [dewiC, dewiA, dewiB]);
    await home.settle();
    expect(await day(fandri)).toEqual(['C', 'A', 'B']);
  });

  it('an edit carries the place, a new date clears it, and an op from a device without it still applies', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    const a = await spend(fandri, bookId, 'A');
    const b = await spend(fandri, bookId, 'B');
    await home.settle();
    await moveTransactionInDay(fandri.database, fandri.ws, a, [a, b]);
    await home.settle();
    expect(await day(dewi)).toEqual(['A', 'B']);

    // A description edit on the same day keeps A on top on both phones.
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const lines = expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 10_000, currency: 'IDR' });
    await pause();
    await replaceTransaction(fandri.database, fandri.ws, a, { occurredOn: DAY, description: 'A edited', lines });
    await home.settle();
    expect(await day(dewi)).toEqual(['A edited', 'B']);

    // A device that predates the field sends a purchase without it: a new date there clears the place here.
    const later = encodeHlc(Date.now() + 60_000, 0, fandri.deviceId);
    await applyChangeSet(dewi.database, bookId, { v: 1, hlc: later, member: fandri.memberId, ops: [{ entity: 'purchase', id: a, op: 'upsert', fields: { occurredOn: '2026-10-13' } }] });
    const [moved] = await dewi.database.db.values<[string, number | null]>(
      sql`SELECT occurred_on, day_order FROM transactions WHERE status = 'posted' AND description = 'A edited'`,
    );
    expect(moved).toEqual(['2026-10-13', null]);
  });

  it('a date changed on one phone while the other moves the row converges: the same date and place on both', async () => {
    const home = new Household();
    const fandri = await home.device('Fandri');
    const dewi = await home.device('Dewi');
    const bookId = await home.share(fandri);
    await home.join(dewi, fandri);
    const a = await spend(fandri, bookId, 'A');
    const b = await spend(fandri, bookId, 'B');
    const c = await spend(fandri, bookId, 'C');
    await home.settle();
    await moveTransactionInDay(fandri.database, fandri.ws, a, [a, c, b]);
    await home.settle();

    // Fandri moves A to the day before; at the same time Dewi, not yet told, moves A to the bottom of the old day.
    const groceries = await categoryOf(fandri.database, bookId, 'Groceries');
    const lines = expenseLines({ categoryAccountId: groceries, paymentAccountId: fandri.bank, amountMinor: 10_000, currency: 'IDR' });
    await replaceTransaction(fandri.database, fandri.ws, a, { occurredOn: '2026-10-13', description: 'A', lines });
    await pause();
    const ids = Object.fromEntries((await listTransactions(dewi.database, dewi.ws, { from: DAY, to: DAY })).map((tx) => [tx.description, tx.id]));
    await moveTransactionInDay(dewi.database, dewi.ws, ids.A!, [ids.C!, ids.B!, ids.A!]);
    for (let i = 0; i < 3; i += 1) await home.settle();

    const stateOf = async (d: Device) =>
      (await d.database.db.values<[string, number | null]>(sql`SELECT occurred_on, day_order FROM transactions WHERE status = 'posted' AND description = 'A'`)).map(
        ([on, order]) => [on, order === null ? null : Number(order)],
      );
    expect(await stateOf(fandri)).toEqual(await stateOf(dewi));
    expect((await stateOf(fandri))[0]![0]).toBe('2026-10-13');
  });
});
