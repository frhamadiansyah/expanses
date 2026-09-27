import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { encodeHlc } from '../../src/sync/hlc';
import type { Op } from '../../src/sync/types';
import { categoryOf, Household, type Device } from './household';

/*
 * §7.1 (task 4 fix round 1): apply skips only an op every receiver would refuse the same way — a SQLite constraint, a
 * posting or ledger refusal on the carried data, a parent that is gone — and records each skip in `sync_skipped`.
 * Anything else is a bug: the entry's transaction rolls back and the cursor stays before it.
 */
async function household() {
  const home = new Household();
  const fandri = await home.device('Fandri');
  const dewi = await home.device('Dewi');
  const bookId = await home.share(fandri);
  await home.join(dewi, fandri);
  await home.settle();
  return { home, fandri, dewi, bookId };
}

let tick = 0;
async function appendOps(home: Household, from: Device, ops: Op[]): Promise<number> {
  const hlc = encodeHlc(Date.now(), (tick += 1), from.deviceId);
  const entry = await from.engine.sealer.seal(home.bookId, 1, { v: 1, hlc, member: from.memberId, ops });
  return (await from.transport.append(home.relayBookId, entry)).seq;
}

const cursor = async (d: Device, bookId: string) => (await d.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`))[0]![0];

const purchase = (id: string, occurredOn: string, money: unknown): Op => ({
  entity: 'purchase',
  id,
  op: 'upsert',
  fields: { occurredOn, description: 'x', channel: null, excluded: 0, bill: null, money },
});

describe('what apply skips, and what it refuses to', () => {
  it('an entry whose change-set hlc names another device than its author is a recorded skip, and the log goes on (final review, I3)', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const groceries = await categoryOf(dewi.database, bookId, 'Groceries');
    const money = { lines: [{ categoryId: groceries, amountMinor: 1_000, currency: 'IDR', amountBaseMinor: 1_000, memo: null }], originalCurrency: null, originalAmountMinor: null, paidBy: fandri.memberId, paidLabel: 'BCA' };
    // Signed and sealed by Fandri's device, but the hlc inside carries Dewi's id: what a change captured under a stand-in
    // id and sealed by the engine would look like.
    const forged = encodeHlc(Date.now(), (tick += 1), dewi.deviceId);
    const entry = await fandri.engine.sealer.seal(home.bookId, 1, { v: 1, hlc: forged, member: fandri.memberId, ops: [purchase('01a0e100-0000-7000-8000-0000000000a1', '2026-09-10', money)] });
    const bad = (await fandri.transport.append(home.relayBookId, entry)).seq;
    const good = await appendOps(home, fandri, [purchase('01a0e100-0000-7000-8000-0000000000a2', '2026-09-10', money)]);
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.skipped.map((s) => [s.seq, s.entity, s.id])).toEqual([[bad, 'change', fandri.deviceId]]);
    expect(result.skipped[0]!.error).toMatch(/hlc/);
    expect(await cursor(dewi, bookId)).toBe(good);
    expect((await dewi.database.db.values(sql`SELECT 1 FROM sync_lineage WHERE lineage_id = '01a0e100-0000-7000-8000-0000000000a1'`)).length).toBe(0);
    expect((await dewi.database.db.values(sql`SELECT 1 FROM sync_lineage WHERE lineage_id = '01a0e100-0000-7000-8000-0000000000a2'`)).length).toBe(1);
  });

  it('a refusal every receiver makes alike is skipped, recorded, and reported; the entries after it still apply', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const groceries = await categoryOf(dewi.database, bookId, 'Groceries');
    const money = { lines: [{ categoryId: groceries, amountMinor: 1_000, currency: 'IDR', amountBaseMinor: 1_000, memo: null }], originalCurrency: null, originalAmountMinor: null, paidBy: fandri.memberId, paidLabel: 'BCA' };
    const bad = await appendOps(home, fandri, [purchase('01a0e100-0000-7000-8000-000000000001', 'not a date', money)]);
    const orphan = await appendOps(home, fandri, [{ entity: 'budget', id: '01a0e100-0000-7000-8000-000000000002', op: 'upsert', fields: { categoryAccountId: '01a0e100-0000-7000-8000-00000000dead', amountMinor: 5 } }]);
    const good = await appendOps(home, fandri, [purchase('01a0e100-0000-7000-8000-000000000003', '2026-09-10', money)]);
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.skipped.map((s) => [s.seq, s.entity])).toEqual([
      [bad, 'purchase'],
      [orphan, 'budget'],
    ]);
    const recorded = await dewi.database.db.values<[number, string, string]>(sql`SELECT seq, entity, error FROM sync_skipped WHERE book_id = ${bookId} ORDER BY seq`);
    expect(recorded.map(([seq, entity]) => [seq, entity])).toEqual([
      [bad, 'purchase'],
      [orphan, 'budget'],
    ]);
    expect(recorded[0]![2]).toMatch(/INVALID_DATE|YYYY-MM-DD/);
    expect(await cursor(dewi, bookId)).toBe(good);
    expect((await dewi.database.db.values(sql`SELECT 1 FROM sync_lineage WHERE lineage_id = '01a0e100-0000-7000-8000-000000000003'`)).length).toBe(1);
  });

  it('a bug in apply rolls the entry back and leaves the cursor before it', async () => {
    const { home, fandri, dewi, bookId } = await household();
    const before = await cursor(dewi, bookId);
    await appendOps(home, fandri, [purchase('01a0e100-0000-7000-8000-000000000004', '2026-09-10', { lines: null, paidBy: fandri.memberId, paidLabel: 'x' })]);
    await expect(dewi.engine.syncOnce(bookId)).rejects.toThrow();
    expect(await cursor(dewi, bookId)).toBe(before);
    expect(await dewi.database.db.values(sql`SELECT 1 FROM sync_skipped`)).toEqual([]);
  });

  it('a CHECK the carried data breaks is skipped; a UNIQUE clash with a row only this device has stops the loop (fix round 2)', async () => {
    const { home, fandri, dewi, bookId } = await household();
    await (await import('../../src/index')).saveBudget(fandri.database, (await import('../../src/index')).inBook(fandri.ws, bookId), { categoryAccountId: await categoryOf(fandri.database, bookId, 'Groceries'), amountMinor: 100_000 });
    await home.settle();
    const [[budgetId]] = (await dewi.database.db.values<[string]>(sql`SELECT id FROM budgets`)) as [[string]];
    const check = await appendOps(home, fandri, [{ entity: 'budget_frequency', id: budgetId, op: 'upsert', fields: { frequency: 'hourly', amountAsSetMinor: 5 } }]);
    const result = await dewi.engine.syncOnce(bookId);
    expect(result.skipped.map((s) => [s.seq, s.entity])).toEqual([[check, 'budget_frequency']]);
    expect(result.skipped[0]!.error).toMatch(/CHECK/);

    const before = await cursor(dewi, bookId);
    // A category with an equity system key: unique per workspace, and Dewi's own workspace already has one.
    await appendOps(home, fandri, [{ entity: 'category', id: '01a0e100-0000-7000-8000-00000000beef', op: 'upsert', fields: { name: 'Clash', parentId: null, kind: 'equity', subtype: 'equity', currency: 'IDR', icon: null, systemKey: 'opening_balance', sortOrder: 0, archivedAt: null } }]);
    await expect(dewi.engine.syncOnce(bookId)).rejects.toMatchObject({ cause: { code: expect.stringMatching(/UNIQUE/) } });
    expect(await cursor(dewi, bookId)).toBe(before);
  });
});
