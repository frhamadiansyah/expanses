import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { postTransaction } from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { MemoryShareRecordStore, type ShareRecord } from '../../src/sync/share-records';
import { categoryOf, Household, type Device } from './household';

/*
 * Share records (sharing resilience §6.1, §6.2 detection, §7): the engine writes one per shared book on share, join,
 * every new epoch key and the cursor (coalesced), removes it when the share ends knowingly here, backfills the ones an
 * older build never wrote, and reads them back at open against the database alone.
 */

async function spend(d: Device, bookId: string, description: string, amountMinor = 17_300): Promise<string> {
  const groceries = await categoryOf(d.database, bookId, 'Groceries');
  return postTransaction(d.database, d.ws, {
    occurredOn: '2026-10-04',
    description,
    lines: expenseLines({ categoryAccountId: groceries, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }),
  });
}

const cursorOf = async (d: Device, bookId: string) =>
  Number((await d.database.db.values<[number]>(sql`SELECT applied_seq FROM sync_cursor WHERE book_id = ${bookId}`))[0]?.[0] ?? 0);

/** A store that cannot be written: a locked keychain, say. */
class BrokenStore extends MemoryShareRecordStore {
  override async put(): Promise<void> {
    throw new Error('keychain locked');
  }
}

describe('share records (spec §6.1)', () => {
  it('are written on share and join, with the keys sealed exactly as the database keeps them', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    for (const d of [dewi, fandri]) {
      const rec = (await d.records.get(bookId))!;
      const [[sealed]] = (await d.database.db.values<[string]>(sql`SELECT key_sealed FROM book_epoch_keys WHERE book_id = ${bookId} AND epoch = 1`)) as [[string]];
      expect(rec).toMatchObject({ bookId, relayBookId: home.relayBookId, deviceId: d.deviceId, memberId: d.memberId });
      expect(rec.epochKeys).toEqual([{ epoch: 1, sealed }]);
    }
    expect((await dewi.records.get(bookId))!.role).toBe('owner');
    expect((await fandri.records.get(bookId))!).toMatchObject({ role: 'member', bookName: 'Personal', bookKind: 'shared', workspaceId: fandri.ws.workspaceId, baseCurrency: 'IDR' });
  });

  it('gain the new epoch key on a rotation, on every device that stays', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const rina = await home.device('Rina');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.join(rina, dewi);
    await home.settle();
    await dewi.engine.removeDevice(bookId, rina.deviceId);
    await home.settle([dewi, fandri]);
    expect((await dewi.records.get(bookId))!.epochKeys.map((k) => k.epoch)).toEqual([1, 2]);
    expect((await fandri.records.get(bookId))!.epochKeys.map((k) => k.epoch)).toEqual([1, 2]);
    const [[sealed2]] = (await fandri.database.db.values<[string]>(sql`SELECT key_sealed FROM book_epoch_keys WHERE book_id = ${bookId} AND epoch = 2`)) as [[string]];
    expect((await fandri.records.get(bookId))!.epochKeys[1]).toEqual({ epoch: 2, sealed: sealed2 });
  });

  it('follow a role change seen in a pull at once', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    expect((await fandri.records.get(bookId))!.role).toBe('member');
    await dewi.engine.makeOwner(bookId, fandri.memberId);
    await home.settle();
    expect((await fandri.records.get(bookId))!.role).toBe('owner');
  });

  it('carry the cursor once it moves, at most every 30 s, and at once on flush', async () => {
    let t = Date.parse('2026-10-04T08:00:00Z');
    const home = new Household();
    const dewi = await home.device('Dewi', undefined, 'IDR', '0.3.0', { now: () => t, recordEveryMs: 30_000 });
    const bookId = await home.share(dewi);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(0);

    t += 31_000;
    await dewi.engine.syncOnce(bookId);
    const first = await cursorOf(dewi, bookId);
    expect(first).toBeGreaterThan(0);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(first);

    await spend(dewi, bookId, 'Market, morning');
    t += 5_000;
    await dewi.engine.syncOnce(bookId);
    const second = await cursorOf(dewi, bookId);
    expect(second).toBeGreaterThan(first);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(first);

    await dewi.engine.flushShareRecord(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(second);

    await spend(dewi, bookId, 'Market, evening');
    t += 30_000;
    await dewi.engine.syncOnce(bookId);
    const third = await cursorOf(dewi, bookId);
    expect(third).toBeGreaterThan(second);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(third);
  });

  it('are removed on stop, leave, a 410, a removal and forget', async () => {
    // Stop, then the partner's 410, then forget on the unshared copy.
    {
      const home = new Household();
      const dewi = await home.device('Dewi');
      const fandri = await home.device('Fandri');
      const bookId = await home.share(dewi);
      await home.join(fandri, dewi);
      await home.settle();
      const fandriRecord = (await fandri.records.get(bookId))!;
      expect(await dewi.records.get(bookId)).not.toBeNull();
      await dewi.engine.stopSharing(bookId);
      expect(await dewi.records.get(bookId)).toBeNull();
      expect(await fandri.records.get(bookId)).not.toBeNull();
      expect((await fandri.engine.syncOnce(bookId)).ended).toBe('unshared');
      expect(await fandri.records.get(bookId)).toBeNull();
      // forgetSharing removes one too: put back as if the removal at the 410 had been missed.
      await fandri.records.put(fandriRecord);
      await fandri.engine.forgetSharing(bookId);
      expect(await fandri.records.get(bookId)).toBeNull();
    }
    // Leave.
    {
      const home = new Household();
      const dewi = await home.device('Dewi');
      const fandri = await home.device('Fandri');
      const bookId = await home.share(dewi);
      await home.join(fandri, dewi);
      await home.settle();
      await fandri.engine.leave(bookId);
      expect(await fandri.records.get(bookId)).toBeNull();
      expect(await dewi.records.get(bookId)).not.toBeNull();
    }
    // A removal: gone after the removed device's next sync.
    {
      const home = new Household();
      const dewi = await home.device('Dewi');
      const fandri = await home.device('Fandri');
      const bookId = await home.share(dewi);
      await home.join(fandri, dewi);
      await home.settle();
      await dewi.engine.removeDevice(bookId, fandri.deviceId);
      expect(await fandri.records.get(bookId)).not.toBeNull();
      expect((await fandri.engine.syncOnce(bookId)).ended).toBe('removed');
      expect(await fandri.records.get(bookId)).toBeNull();
      expect(await dewi.records.get(bookId)).not.toBeNull();
    }
  });

  it("never remove another device's record", async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const other: ShareRecord = { ...(await fandri.records.get(bookId))!, deviceId: 'device-other' };
    await fandri.records.put(other);
    await dewi.engine.stopSharing(bookId);
    expect((await fandri.engine.syncOnce(bookId)).ended).toBe('unshared');
    expect(await fandri.records.get(bookId)).toEqual(other);
  });

  it('backfill writes one for an active book with no record, and none for a book whose keys do not open', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const written = (await fandri.records.get(bookId))!;
    await fandri.records.remove(bookId);
    expect(await fandri.engine.backfillShareRecords()).toBe(1);
    expect(await fandri.records.get(bookId)).toMatchObject({ ...written, updatedAt: expect.any(String) });
    expect(await fandri.engine.backfillShareRecords()).toBe(0);

    const restored = await home.restore(fandri, await fandri.database.exportBytes());
    expect(await restored.engine.backfillShareRecords()).toBe(0);
    expect(await restored.records.list()).toEqual([]);
  });

  it('a store that fails never fails a share, a join or a sync', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const home = new Household();
      const dewi = await home.device('Dewi');
      const fandri = await home.device('Fandri');
      const problems: (string | null)[] = [];
      for (const d of [dewi, fandri]) {
        d.records = new BrokenStore();
        d.engine = new SyncEngine(d.database, d.transport, d.keys, undefined, { shareRecords: d.records, onShareRecordProblem: (bookId) => problems.push(bookId) });
      }
      const bookId = await home.share(dewi);
      await home.join(fandri, dewi);
      await home.settle();
      expect(await fandri.database.db.values(sql`SELECT state FROM shared_books WHERE book_id = ${bookId}`)).toEqual([['active']]);
      expect(await dewi.records.list()).toEqual([]);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.every((b) => b === bookId)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('checkShareRecords finds a lost share: the book here, its shared_books row gone', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    await dewi.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: home.relayBookId }]);
  });

  it('checkShareRecords calls a copy waiting for an invite on the same relay book, or on another relay book, lost', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    await dewi.database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: home.relayBookId }]);
    await dewi.database.db.run(sql`UPDATE shared_books SET relay_book_id = 'relay-elsewhere' WHERE book_id = ${bookId}`);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: home.relayBookId }]);
  });

  it("checkShareRecords finds a missing book and a copy behind, and ignores another device's record", async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    await dewi.engine.flushShareRecord(bookId);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'ok', bookId }]);

    const rec = (await dewi.records.get(bookId))!;
    expect(rec.appliedSeq).toBeGreaterThan(0);
    await dewi.records.put({ ...rec, bookId: 'book-gone', bookName: 'Holiday house' });
    await dewi.records.put({ ...rec, bookId: 'book-of-another-phone', deviceId: 'device-other' });
    await dewi.database.db.run(sql`UPDATE sync_cursor SET applied_seq = 0 WHERE book_id = ${bookId}`);

    const findings = await dewi.engine.checkShareRecords();
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual({ kind: 'behind', bookId, bookName: 'Personal', fromSeq: 0, toSeq: rec.appliedSeq });
    expect(findings).toContainEqual({ kind: 'missing_book', bookId: 'book-gone', bookName: 'Holiday house', relayBookId: home.relayBookId });
    // Detection writes nothing over what it found: the record keeps the cursor the copy is behind.
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(rec.appliedSeq);
    expect((await dewi.records.get('book-of-another-phone'))!.deviceId).toBe('device-other');
  });
});
