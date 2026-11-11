import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase, postTransaction, type Database } from '../../src/index';
import { createNodeExecutor } from '../../src/node';
import { SyncEngine } from '../../src/sync/engine';
import { SharingError } from '../../src/sync/seed';
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

/** The phone's database lost and a copy put back: same keys, same share records (they live outside the database). */
async function lose(d: Device, backup: Uint8Array): Promise<{ database: Database; engine: SyncEngine }> {
  const database = createDatabase(createNodeExecutor());
  await database.importBytes(backup);
  return { database, engine: new SyncEngine(database, d.transport, d.keys, undefined, { shareRecords: d.records }) };
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

  it('carry the cursor once it moves, at most every 30 s, and at once on flush or when own entries went out', async () => {
    let t = Date.now();
    const home = new Household();
    const dewi = await home.device('Dewi', undefined, 'IDR', '0.3.0', { now: () => t, recordEveryMs: 30_000 });
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();

    t += 31_000;
    await dewi.engine.syncOnce(bookId);
    const first = await cursorOf(dewi, bookId);
    expect(first).toBeGreaterThan(0);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(first);

    // Only a partner's entry moves the cursor: it waits for the 30 s.
    await spend(fandri, bookId, 'Market, morning');
    await fandri.engine.syncOnce(bookId);
    t += 5_000;
    expect((await dewi.engine.syncOnce(bookId)).pushed).toBe(0);
    const second = await cursorOf(dewi, bookId);
    expect(second).toBeGreaterThan(first);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(first);

    await dewi.engine.flushShareRecord(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(second);

    await spend(fandri, bookId, 'Market, evening');
    await fandri.engine.syncOnce(bookId);
    t += 30_000;
    await dewi.engine.syncOnce(bookId);
    const third = await cursorOf(dewi, bookId);
    expect(third).toBeGreaterThan(second);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(third);

    // Review M3: a sync that sent this device's own entries writes at once — they are the ones a replay needs.
    await spend(dewi, bookId, 'Bakery');
    t += 1_000;
    expect((await dewi.engine.syncOnce(bookId)).pushed).toBeGreaterThan(0);
    const fourth = await cursorOf(dewi, bookId);
    expect(fourth).toBeGreaterThan(third);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(fourth);
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
        await d.engine.checkShareRecords();
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

  /* ---- fix round 1: a database older than the record never rewrites or removes it (review C1, C2, I1) ---- */

  it('a restored copy active on an older relay book reports lost, and neither its sync nor its 410 touches the newer record', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const r1 = home.relayBookId;
    await home.join(fandri, dewi);
    await home.settle();
    const onR1 = (await fandri.records.get(bookId))!;
    const backup = await fandri.database.exportBytes();

    await dewi.engine.stopSharing(bookId);
    expect((await fandri.engine.syncOnce(bookId)).ended).toBe('unshared');
    // As if the removal at the 410 had been missed: a join onto another share replaces it all the same.
    await fandri.records.put(onR1);
    const again = await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: "Dewi's phone" });
    home.relayBookId = again.relayBookId;
    await dewi.engine.syncOnce(bookId);
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
    await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: 'Fandri', deviceName: "Fandri's phone" });
    await home.settle([dewi, fandri]);
    const onR2 = (await fandri.records.get(bookId))!;
    expect(onR2.relayBookId).toBe(again.relayBookId);
    expect(again.relayBookId).not.toBe(r1);

    const lost = await lose(fandri, backup);
    expect(await lost.engine.checkRestore()).toEqual([]);
    expect(await lost.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: again.relayBookId }]);
    expect(await fandri.records.get(bookId)).toEqual(onR2);
    expect((await lost.engine.syncOnce(bookId)).ended).toBe('unshared'); // R1 is gone: 410
    expect(await fandri.records.get(bookId)).toEqual(onR2);
    await lost.engine.flushShareRecord(bookId);
    expect(await fandri.records.get(bookId)).toEqual(onR2);
  });

  it('a record on an older relay book than the database is left alone by sync, flush and the check (a missed write)', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const stale: ShareRecord = { ...(await fandri.records.get(bookId))!, relayBookId: 'relay-before' };
    await fandri.records.put(stale);
    await spend(dewi, bookId, 'Pharmacy');
    await home.settle();
    await fandri.engine.flushShareRecord(bookId);
    expect(await fandri.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: 'relay-before' }]);
    expect(await fandri.records.get(bookId)).toEqual(stale);
  });

  it('a restored copy unshared on the very relay book it was rejoined on reports lost and keeps the record', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    await fandri.engine.leave(bookId);
    const backup = await fandri.database.exportBytes();
    const { code } = await dewi.engine.createInvite(bookId, { inviterName: 'Dewi', sameMember: true, memberId: fandri.memberId });
    await fandri.engine.joinBook(code, { ws: fandri.ws, memberName: 'Fandri', deviceName: "Fandri's phone" });
    await home.settle([dewi, fandri]);
    const live = (await fandri.records.get(bookId))!;
    expect(live.relayBookId).toBe(home.relayBookId);

    const lost = await lose(fandri, backup);
    expect(await lost.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: home.relayBookId }]);
    expect(await fandri.records.get(bookId)).toEqual(live);
  });

  it('a copy behind stays behind after an ordinary sync and a flush, until its replay point is cleared', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const backup = await dewi.database.exportBytes();
    const copied = await cursorOf(dewi, bookId);
    await spend(dewi, bookId, 'Own, after the copy');
    await home.settle();
    await dewi.engine.flushShareRecord(bookId);
    const head = (await dewi.records.get(bookId))!.appliedSeq;
    expect(head).toBeGreaterThan(copied);

    const lost = await lose(dewi, backup);
    const behind = { kind: 'behind', bookId, bookName: 'Personal', fromSeq: copied, toSeq: head };
    expect(await lost.engine.checkShareRecords()).toEqual([behind]);
    await lost.engine.syncOnce(bookId);
    await lost.engine.flushShareRecord(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBeGreaterThanOrEqual(head); // the record carries on
    const reopened = new SyncEngine(lost.database, dewi.transport, dewi.keys, undefined, { shareRecords: dewi.records });
    expect(await reopened.checkShareRecords()).toEqual([behind]);
    expect(await reopened.replayPointOf(bookId)).toEqual({ relayBookId: home.relayBookId, fromSeq: copied, toSeq: head });

    await reopened.clearReplayPoint(bookId);
    expect(await reopened.replayPointOf(bookId)).toBeNull();
    expect(await reopened.checkShareRecords()).toEqual([{ kind: 'ok', bookId }]);
  });

  it('dropShareRecord removes the record of the share here, and never one of another relay book or device', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const rec = (await fandri.records.get(bookId))!;

    await fandri.records.put({ ...rec, relayBookId: 'relay-other' });
    expect(await fandri.engine.dropShareRecord(bookId)).toBe(false);
    expect((await fandri.records.get(bookId))!.relayBookId).toBe('relay-other');
    await fandri.records.put({ ...rec, deviceId: 'device-other' });
    expect(await fandri.engine.dropShareRecord(bookId)).toBe(false);
    expect((await fandri.records.get(bookId))!.deviceId).toBe('device-other');

    await fandri.records.put(rec);
    expect(await fandri.engine.dropShareRecord(bookId)).toBe(true);
    expect(await fandri.records.get(bookId)).toBeNull();

    // After the book is deleted here its relay book is named by the caller, read before the delete.
    await fandri.records.put(rec);
    await fandri.database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
    expect(await fandri.engine.dropShareRecord(bookId)).toBe(false);
    expect(await fandri.records.get(bookId)).toEqual(rec);
    expect(await fandri.engine.dropShareRecord(bookId, home.relayBookId)).toBe(true);
    expect(await fandri.records.get(bookId)).toBeNull();
  });

  it('one record that cannot be read against the database is skipped; the others are still found', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    const rec = (await dewi.records.get(bookId))!;
    await dewi.records.put({ ...rec, bookId: 'book-gone', bookName: 'Holiday house' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const values = vi.spyOn(dewi.database.db, 'values').mockRejectedValueOnce(new Error('disk I/O error'));
    try {
      const findings = await dewi.engine.checkShareRecords();
      expect(findings).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      values.mockRestore();
      warn.mockRestore();
    }
  });

  /* ---- fix round 2: detection comes first, and Share does not drop a lost share (re-review N1, N2) ---- */

  /** A copy taken after the share, then an own purchase that reached the log: the copy is behind once restored. */
  async function behindSetup() {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    await home.join(fandri, dewi);
    await home.settle();
    const backup = await dewi.database.exportBytes();
    const copied = await cursorOf(dewi, bookId);
    await spend(dewi, bookId, 'Own, after the copy');
    await home.settle();
    await dewi.engine.flushShareRecord(bookId);
    const head = (await dewi.records.get(bookId))!.appliedSeq;
    return { home, dewi, bookId, backup, copied, head };
  }

  it('a flush before the check writes nothing: the copy is still found behind', async () => {
    const { dewi, bookId, backup, copied, head } = await behindSetup();
    const lost = await lose(dewi, backup);
    await lost.engine.flushShareRecord(bookId);
    expect(await lost.engine.backfillShareRecords()).toBe(0);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(head);
    expect(await lost.engine.checkShareRecords()).toEqual([{ kind: 'behind', bookId, bookName: 'Personal', fromSeq: copied, toSeq: head }]);
  });

  it('a sync before the check writes nothing: the copy is still found behind', async () => {
    const { dewi, bookId, backup, copied, head } = await behindSetup();
    const lost = await lose(dewi, backup);
    await lost.engine.syncOnce(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(head);
    const [finding] = await lost.engine.checkShareRecords();
    expect(finding).toEqual({ kind: 'behind', bookId, bookName: 'Personal', fromSeq: copied, toSeq: head });
  });

  it('Share on a copy that lost its share is refused until the old share is discarded', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const preShare = await dewi.database.exportBytes();
    const bookId = await home.share(dewi);
    const r1 = home.relayBookId;
    await home.join(fandri, dewi);
    await home.settle();
    const record = (await dewi.records.get(bookId))!;

    const lost = await lose(dewi, preShare);
    expect(await lost.engine.checkShareRecords()).toEqual([{ kind: 'lost', bookId, bookName: 'Personal', relayBookId: r1 }]);
    const books = home.relay.peek(r1) ? 1 : 0;
    const refusal = await lost.engine.shareBook(bookId, { memberId: dewi.memberId, memberName: 'Dewi', deviceName: "Dewi's phone" }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(SharingError);
    expect((refusal as SharingError).code).toBe('RECORD_ELSEWHERE');
    expect((refusal as SharingError).message).not.toMatch(/\b(you|your|my)\b/i);
    expect(await dewi.records.get(bookId)).toEqual(record);
    expect(await lost.database.db.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId}`)).toEqual([]);
    expect(books).toBe(1);

    // Refused from the record alone too, on an engine whose check has not run.
    const fresh = new SyncEngine(lost.database, dewi.transport, dewi.keys, undefined, { shareRecords: dewi.records });
    await expect(fresh.shareBook(bookId, { memberId: dewi.memberId, memberName: 'Dewi', deviceName: "Dewi's phone" })).rejects.toMatchObject({ code: 'RECORD_ELSEWHERE' });

    expect(await lost.engine.discardShareRecord(bookId)).toBe(true);
    expect(await dewi.records.get(bookId)).toBeNull();
    const again = await lost.engine.shareBook(bookId, { memberId: dewi.memberId, memberName: 'Dewi', deviceName: "Dewi's phone" });
    expect(again.relayBookId).not.toBe(r1);
    expect((await dewi.records.get(bookId))!.relayBookId).toBe(again.relayBookId);
  });

  it('stopping the share here and sharing again is never refused', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const fandri = await home.device('Fandri');
    const bookId = await home.share(dewi);
    const r1 = home.relayBookId;
    await home.join(fandri, dewi);
    await home.settle();
    await dewi.engine.stopSharing(bookId);
    expect(await dewi.records.get(bookId)).toBeNull();
    const again = await dewi.engine.shareBook(bookId, { memberName: 'Dewi', deviceName: "Dewi's phone" });
    expect(again.relayBookId).not.toBe(r1);
    expect((await dewi.records.get(bookId))!.relayBookId).toBe(again.relayBookId);
  });

  /* ---- fix round 3: a database replaced under a live engine is checked again (re-review 2, R1) ---- */

  it('an in-app restore under a live engine: a flush and a sync before the reload keep the copy behind', async () => {
    const { dewi, bookId, backup, copied, head } = await behindSetup();
    // BackupPage, the iCloud runner: the copy goes into the very database the running engine holds.
    await dewi.database.importBytes(backup);
    await dewi.engine.flushShareRecord(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(head);
    await dewi.engine.syncOnce(bookId); // a scheduler tick before the reload
    expect((await dewi.records.get(bookId))!.appliedSeq).toBeGreaterThanOrEqual(head);
    const reloaded = new SyncEngine(dewi.database, dewi.transport, dewi.keys, undefined, { shareRecords: dewi.records });
    expect(await reloaded.checkShareRecords()).toEqual([{ kind: 'behind', bookId, bookName: 'Personal', fromSeq: copied, toSeq: head }]);
  });

  it('databaseReplaced holds every record write until the records are checked again', async () => {
    const home = new Household();
    const dewi = await home.device('Dewi');
    const bookId = await home.share(dewi);
    await dewi.engine.syncOnce(bookId);
    await dewi.engine.flushShareRecord(bookId);
    const before = (await dewi.records.get(bookId))!;
    await spend(dewi, bookId, 'Stationery');
    await dewi.database.db.run(sql`UPDATE sync_cursor SET applied_seq = applied_seq + 5 WHERE book_id = ${bookId}`); // the cursor moves, nothing is pulled

    dewi.engine.databaseReplaced();
    await dewi.engine.flushShareRecord(bookId);
    expect(await dewi.engine.backfillShareRecords()).toBe(0);
    expect(await dewi.records.get(bookId)).toEqual(before);
    expect(await dewi.engine.checkShareRecords()).toEqual([{ kind: 'ok', bookId }]);
    await dewi.engine.flushShareRecord(bookId);
    expect((await dewi.records.get(bookId))!.appliedSeq).toBe(await cursorOf(dewi, bookId));
  });
});
