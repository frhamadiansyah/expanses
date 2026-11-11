import { expenseLines } from '@expanses/core';
import {
  createAccount,
  createBook,
  createDatabase,
  createWorkspace,
  type Database,
  type DeviceKeys,
  devicesSeen,
  listSharedBooks,
  MemoryKeyStore,
  MemoryShareRecordStore,
  MemoryTransport,
  migrate,
  personalBook,
  postTransaction,
  requestSignerOf,
  sharingDetail,
  SyncTransportError,
  type SyncTransport,
  type WorkspaceContext,
} from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { SyncService } from './sync-service';

/*
 * The app's sync wiring (spec §9.4, §11): no keys and no request while nothing is shared; Share drains the whole history
 * before the invite, reporting "Preparing N of M" as it goes; a joined book syncs, and a run that applied something
 * tells the screens to re-read; a removal rotates the key.
 */

vi.setConfig({ testTimeout: 30_000 });

interface Phone {
  database: Database;
  ws: WorkspaceContext;
  bank: string;
  service: SyncService;
  applied: ReturnType<typeof vi.fn>;
  transports: (device: DeviceKeys) => SyncTransport;
  keys: MemoryKeyStore & { made: ReturnType<typeof vi.fn> };
  errors: ReturnType<typeof vi.fn>;
  /** Relay books whose pulls fail (503) for this phone. */
  failing: Set<string>;
  /** This phone's share records (sharing resilience §6.1), beside its keys. */
  records: MemoryShareRecordStore;
}

async function phone(relay: MemoryTransport, name: string): Promise<Phone> {
  const database = createDatabase(createNodeExecutor());
  await migrate(database);
  const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
  const bank = await createAccount(database, ws, { name: `${name} Bank`, kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const store = new MemoryKeyStore();
  const made = vi.fn();
  const keys = Object.assign(store, {
    made,
    getOrCreateDevice: ((original) => () => {
      made();
      return original();
    })(store.getOrCreateDevice.bind(store)),
  });
  const applied = vi.fn();
  const failing = new Set<string>();
  const transports = vi.fn((device: DeviceKeys): SyncTransport => {
    const transport = relay.as(requestSignerOf(device));
    const pull = transport.pull.bind(transport);
    transport.pull = async (bookId, since) => {
      if (failing.has(bookId)) throw new SyncTransportError(503, 'unavailable');
      return pull(bookId, since);
    };
    return transport;
  });
  const errors = vi.fn();
  const records = new MemoryShareRecordStore();
  const service = new SyncService({ database, keyStore: keys, shareRecords: records, transportFor: transports, onApplied: applied, onError: errors, intervalMs: 60 * 60_000 });
  return { database, ws, bank: bank.id, service, applied, transports, keys, errors, failing, records };
}

/** An expense category of the book, the same one on every device (categories sync under the owner's ids). */
async function groceries(database: Database, bookId: string): Promise<string> {
  const [row] = await database.db.values<[string]>(
    sql`SELECT a.id FROM accounts a JOIN book_categories bc ON bc.category_account_id = a.id WHERE bc.book_id = ${bookId} AND a.kind = 'expense' ORDER BY a.name LIMIT 1`,
  );
  return row![0];
}

describe('SyncService', () => {
  it('makes no keys and sends nothing while no book is shared', async () => {
    const relay = new MemoryTransport();
    const alone = await phone(relay, 'Alone');
    await alone.service.start();
    alone.service.nudge();
    expect(alone.keys.made).not.toHaveBeenCalled();
    expect(vi.mocked(alone.transports)).not.toHaveBeenCalled();
    alone.service.stop();
  });

  it('shares with its history drained first, joins, syncs both ways, and a removal rotates the key', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    const dewi = await phone(relay, 'Dewi');
    await fandri.service.start();
    await dewi.service.start();

    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-01',
      description: 'history',
      lines: expenseLines({ categoryAccountId: await groceries(fandri.database, bookId), paymentAccountId: fandri.bank, amountMinor: 10_000, currency: 'IDR' }),
    });

    const progress: [number, number][] = [];
    const invite = await fandri.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' }, (done, total) => progress.push([done, total]));
    expect(invite.code).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    expect(invite.link).toBe(`cicis://join/${invite.code}`);
    const total = progress[0]![1];
    expect(total).toBeGreaterThan(1);
    expect(progress[0]).toEqual([0, total]);
    expect(progress.at(-1)).toEqual([total, total]);
    expect((await sharingDetail(fandri.database, bookId, await fandri.service.deviceId()))!.waiting).toBe(0);

    const preview = await dewi.service.preview(invite.code);
    expect(preview).toMatchObject({ bookName: 'Personal', inviterName: 'Fandri', baseCurrency: 'IDR' });
    await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
    expect(dewi.applied).toHaveBeenCalled();
    const [joined] = await listSharedBooks(dewi.database);
    expect(joined).toMatchObject({ bookId, state: 'active' });
    expect(joined!.members.map((m) => m.name)).toEqual(['Fandri', 'Dewi']);
    expect(dewi.service.status(bookId)).toMatchObject({ failing: false, lastSyncedAt: expect.any(Number) });

    // Dewi records; a nudge sends it, and Fandri's next run applies it and tells the screens.
    const dewiWs = { ...dewi.ws, bookId };
    await postTransaction(dewi.database, dewiWs, {
      occurredOn: '2026-09-02',
      description: 'from Dewi',
      lines: expenseLines({ categoryAccountId: await groceries(dewi.database, bookId), paymentAccountId: dewi.bank, amountMinor: 5_000, currency: 'IDR' }),
    });
    await dewi.service.syncNow(bookId);
    fandri.applied.mockClear();
    await fandri.service.syncNow(bookId);
    expect(fandri.applied).toHaveBeenCalled();
    const onFandri = await fandri.database.db.values<[string]>(sql`SELECT description FROM transactions WHERE status = 'posted' ORDER BY description`);
    expect(onFandri.map(([d]) => d)).toContain('from Dewi');

    // Both devices are listed on each side, and each has been heard from.
    const detail = (await sharingDetail(fandri.database, bookId, await fandri.service.deviceId()))!;
    const devices = detail.members.flatMap((m) => m.devices);
    expect(devices).toHaveLength(2);
    for (const device of devices) expect(device.seenAt).toEqual(expect.any(Number));

    // The owner removes Dewi's phone: the relay drops it, and the owner rotates to epoch 2.
    const dewiDevice = devices.find((d) => !d.mine)!;
    await fandri.service.removeDevice(bookId, dewiDevice.deviceId);
    const [epoch] = await fandri.database.db.values<[number]>(sql`SELECT epoch FROM shared_books WHERE book_id = ${bookId}`);
    expect(Number(epoch![0])).toBe(2);
    expect((await sharingDetail(fandri.database, bookId, await fandri.service.deviceId()))!.members.flatMap((m) => m.devices)).toHaveLength(1);

    // Dewi's next run is told she was removed (final review, I2): the book ends here, read-only, and is no longer polled.
    dewi.applied.mockClear();
    await dewi.service.syncNow(bookId);
    expect(dewi.service.status(bookId).failing).toBe(false);
    expect(dewi.applied).toHaveBeenCalled();
    expect((await listSharedBooks(dewi.database))[0]).toMatchObject({ bookId, state: 'unshared', unsharedReason: 'removed' });
    expect(dewi.service.syncing()).toEqual([]);

    fandri.service.stop();
    dewi.service.stop();
  });

  it('a household sets up net worth through the service, and a group log that fails is reported without failing the workspace', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    const dewi = await phone(relay, 'Dewi');
    await fandri.service.start();
    await dewi.service.start();
    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    const invite = await fandri.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
    await fandri.service.syncNow(bookId);
    const dewiMember = (await listSharedBooks(dewi.database))[0]!.memberId;

    await fandri.service.proposeNetWorth(bookId, { mode: 'joint', members: [dewiMember] });
    for (let i = 0; i < 2; i += 1) {
      await dewi.service.syncNow(bookId);
      await fandri.service.syncNow(bookId);
    }
    const asked = await dewi.service.netWorthGroup(bookId);
    expect(asked?.waitingFor).toEqual([dewiMember]);
    await dewi.service.answerNetWorth(bookId, asked!.pending!.proposalId, 'confirm');
    await fandri.service.syncNow(bookId);
    expect((await fandri.service.netWorthGroup(bookId))?.active?.mode).toBe('joint');

    const [[groupRelay]] = (await fandri.database.db.values<[string]>(
      sql`SELECT s.relay_book_id FROM shared_books s JOIN nw_group_books g ON g.group_book_id = s.book_id`,
    )) as [[string]];
    fandri.failing.add(groupRelay);
    fandri.errors.mockClear();
    await fandri.service.syncNow(bookId);
    expect(fandri.service.status(bookId)).toMatchObject({ failing: false, groupFailing: true });
    expect(fandri.errors).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
    fandri.failing.clear();
    await fandri.service.syncNow(bookId);
    expect(fandri.service.status(bookId).groupFailing).toBe(false);

    fandri.service.stop();
    dewi.service.stop();
  });

  it('notes when this device was last heard from only once it has moved by more than a minute (final review, minor 4)', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    // A clock ahead of the wall clock, so the entries this device pulls back (stamped by capture at wall time) never
    // count as heard later than the run itself.
    let now = Date.now() + 60 * 60_000;
    const service = new SyncService({ database: fandri.database, keyStore: fandri.keys, shareRecords: fandri.records, transportFor: fandri.transports, onError: () => {}, now: () => now, intervalMs: 60 * 60_000 });
    await service.start();
    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    await service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    const me = (await service.deviceId())!;
    const seen = async () => (await devicesSeen(fandri.database, bookId))[me];
    expect(await seen()).toBe(now);
    now += 30_000;
    await service.syncNow(bookId);
    expect(await seen()).toBe(now - 30_000);
    now += 31_000;
    await service.syncNow(bookId);
    expect(await seen()).toBe(now);
    service.stop();
  });

  it('at open, a device holding a shared book makes its engine before anything is written', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    await fandri.service.start();
    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    await fandri.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    fandri.service.stop();

    // The same database opened again, by a new service over the same keys.
    const again = new SyncService({ database: fandri.database, keyStore: fandri.keys, shareRecords: fandri.records, transportFor: fandri.transports, onError: () => {} });
    expect(await again.deviceId()).toBeNull();
    await again.prepare();
    expect(await again.deviceId()).toBe((await fandri.keys.getOrCreateDevice()).deviceId);
    again.stop();
  });

  it('a Share whose history fails to go up still leaves the book shared, syncing, and able to invite once the relay is back', async () => {
    const relay = new MemoryTransport();
    let down = false;
    const fandri = await phone(relay, 'Fandri');
    const flaky = new SyncService({
      database: fandri.database,
      keyStore: fandri.keys,
      shareRecords: fandri.records,
      transportFor: (device) => {
        const inner = relay.as(requestSignerOf(device));
        return {
          ...inner,
          createBook: (d) => inner.createBook(d),
          append: (b, e) => (down ? Promise.reject(new Error('relay unreachable: offline')) : inner.append(b, e)),
          pull: (b, n) => inner.pull(b, n),
          putInvite: (b, i) => inner.putInvite(b, i),
          previewInvite: (i) => inner.previewInvite(i),
          claimInvite: (i, d) => inner.claimInvite(i, d),
          removeDevice: (b, d) => inner.removeDevice(b, d),
          setOwners: (b, d) => inner.setOwners(b, d),
          deleteBook: (b) => inner.deleteBook(b),
        };
      },
      onError: () => {},
      intervalMs: 60 * 60_000,
    });
    await flaky.start();
    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    const heard = vi.fn();
    flaky.subscribe(heard);
    down = true;
    await expect(flaky.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' })).rejects.toThrow(/unreachable/);

    // Shared all the same: the book is there, its changes wait, the screens were told, and it has a schedule.
    expect(await listSharedBooks(fandri.database)).toEqual([expect.objectContaining({ bookId, state: 'active' })]);
    expect((await sharingDetail(fandri.database, bookId, await flaky.deviceId()))!.waiting).toBeGreaterThan(0);
    expect(heard).toHaveBeenCalled();
    expect(flaky.syncing()).toContain(bookId);
    expect(flaky.status(bookId).failing).toBe(true);
    expect((flaky.status(bookId).lastError as Error).message).toMatch(/unreachable/);
    // The log says it was the upload of the history, for which book on the relay, and what the engine said after.
    const [relayBook] = await listSharedBooks(fandri.database);
    const [drain] = await flaky.log.forBook(bookId);
    expect(drain).toMatchObject({ level: 'error', op: 'drain', bookId, relayBookId: relayBook!.relayBookId.slice(0, 8), message: 'relay unreachable: offline' });
    expect(drain!.state).toMatch(/^waiting \d+$/);

    // The relay comes back: the next run sends it all, and Invite someone works.
    down = false;
    await flaky.syncNow(bookId);
    expect(flaky.status(bookId).lastError).toBeNull();
    expect((await sharingDetail(fandri.database, bookId, await flaky.deviceId()))!.waiting).toBe(0);
    await expect(flaky.invite(bookId, 'Fandri')).resolves.toMatchObject({ code: expect.any(String) });
    // A background run that fails is logged too, as `sync`.
    down = true;
    await fandri.database.db.run(sql`UPDATE shared_books SET synced_at = NULL WHERE book_id = ${bookId}`);
    await postTransaction(fandri.database, fandri.ws, {
      occurredOn: '2026-09-10',
      description: 'Zebra snack',
      lines: expenseLines({ categoryAccountId: await groceries(fandri.database, bookId), paymentAccountId: fandri.bank, amountMinor: 7_345, currency: 'IDR' }),
    });
    await flaky.syncNow(bookId);
    const latest = (await flaky.log.forBook(bookId))[0]!;
    expect(latest.op).toBe('sync');
    expect(JSON.stringify(await flaky.log.entries())).not.toMatch(/Zebra|7345/);
    flaky.stop();
  });

  it('a book that stops being active stops being polled', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    await fandri.service.start();
    const bookId = (await personalBook(fandri.database, fandri.ws)).id;
    await fandri.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    expect(fandri.service.syncing()).toContain(bookId);
    await fandri.database.db.run(sql`UPDATE shared_books SET state = 'needs_invite' WHERE book_id = ${bookId}`);
    await fandri.service.syncNow(bookId);
    expect(fandri.service.syncing()).not.toContain(bookId);
    fandri.service.stop();
  });

  describe('the edges (task 9b)', () => {
    async function household() {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      const dewi = await phone(relay, 'Dewi');
      await fandri.service.start();
      await dewi.service.start();
      const bookId = (await personalBook(fandri.database, fandri.ws)).id;
      const invite = await fandri.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
      await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
      await fandri.service.syncNow(bookId);
      return { fandri, dewi, bookId };
    }
    const memberOf = async (p: Phone, bookId: string, name: string) =>
      (await sharingDetail(p.database, bookId, await p.service.deviceId()))!.members.find((m) => m.name === name)!;

    it('make owner: the new owner can invite', async () => {
      const { fandri, dewi, bookId } = await household();
      await expect(dewi.service.invite(bookId, 'Dewi')).rejects.toMatchObject({ code: 'NOT_OWNER' });
      await fandri.service.makeOwner(bookId, (await memberOf(fandri, bookId, 'Dewi')).memberId);
      await dewi.service.syncNow(bookId);
      expect((await memberOf(dewi, bookId, 'Dewi')).role).toBe('owner');
      await expect(dewi.service.invite(bookId, 'Dewi')).resolves.toMatchObject({ code: expect.any(String) });
      fandri.service.stop();
      dewi.service.stop();
    });

    it('an owner links a device for another member: the invite joins as that member', async () => {
      const { fandri, dewi, bookId } = await household();
      const dewiId = (await memberOf(fandri, bookId, 'Dewi')).memberId;
      const link = await fandri.service.linkDeviceFor(bookId, 'Fandri', dewiId);
      expect((await dewi.service.preview(link.code)).terms).toMatchObject({ sameMember: true, memberId: dewiId });
      fandri.service.stop();
      dewi.service.stop();
    });

    it('leave: the leaver keeps the book, unshared and no longer polled; the last owner may not leave', async () => {
      const { fandri, dewi, bookId } = await household();
      await expect(fandri.service.leave(bookId)).rejects.toMatchObject({ name: 'LastOwnerError' });
      dewi.applied.mockClear();
      await dewi.service.leave(bookId);
      expect(await dewi.service.bookStatus(bookId)).toMatchObject({ state: 'unshared', byYou: true });
      expect(dewi.service.syncing()).not.toContain(bookId);
      expect(dewi.applied).toHaveBeenCalled();
      fandri.service.stop();
      dewi.service.stop();
    });

    it('stop sharing: the other side learns on its next run who stopped it, and stops polling', async () => {
      const { fandri, dewi, bookId } = await household();
      await fandri.service.stopSharing(bookId);
      expect(await fandri.service.bookStatus(bookId)).toBeNull();
      expect(fandri.service.syncing()).not.toContain(bookId);
      dewi.applied.mockClear();
      await dewi.service.syncNow(bookId);
      expect(await dewi.service.bookStatus(bookId)).toMatchObject({ state: 'unshared', byName: 'Fandri', byYou: false });
      expect(dewi.service.syncing()).not.toContain(bookId);
      expect(dewi.applied).toHaveBeenCalled();
      fandri.service.stop();
      dewi.service.stop();
    });
  });
  describe('sharing resilience (spec §4, §5, §6.2, §7)', () => {
    /** A second workspace of the phone, shared by its owner: deletable, unlike Personal. */
    async function sharedHome(p: Phone, name = 'Home') {
      const bookId = await createBook(p.database, p.ws, { name, kind: 'family', baseCurrency: 'IDR' });
      const invite = await p.service.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
      return { bookId, invite };
    }
    const again = (p: Phone) => new SyncService({ database: p.database, keyStore: p.keys, shareRecords: p.records, transportFor: p.transports, onError: () => {}, log: p.service.log, intervalMs: 60 * 60_000 });

    it('at open, a record whose share is gone here is found lost, logged, and checked even with no shared book left', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const homeId = await createBook(fandri.database, fandri.ws, { name: 'Home', kind: 'family', baseCurrency: 'IDR' });
      const beforeShare = await fandri.database.exportBytes();
      await fandri.service.share(homeId, { memberName: 'Fandri', deviceName: 'Mac' });
      const bookId = homeId;
      expect(await fandri.records.get(bookId)).toMatchObject({ bookId });
      fandri.service.stop();
      // The database lost the share: a copy from before it is restored. The record outside the database is still there.
      await fandri.database.importBytes(beforeShare);
      expect(await listSharedBooks(fandri.database)).toEqual([]);

      const opened = again(fandri);
      await opened.prepare();
      expect(opened.findings()).toEqual([{ kind: 'lost', bookId, bookName: 'Home', relayBookId: expect.any(String) }]);
      expect(opened.lostHere(bookId)).toBe(true);
      const [line] = (await opened.log.forBook(bookId)).filter((entry) => entry.op === 'records');
      expect(line).toMatchObject({ level: 'info', op: 'records', bookId });
      expect(line!.message).toMatch(/lost/);

      // Share is refused over it until the old share is discarded; then it goes through.
      await opened.start();
      await expect(opened.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' })).rejects.toMatchObject({ code: 'RECORD_ELSEWHERE' });
      expect(await opened.discardShareRecord(bookId)).toBe(true);
      expect(opened.findings()).toEqual([]);
      await expect(opened.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' })).resolves.toMatchObject({ code: expect.any(String) });
      opened.stop();
    });

    it('a phone that never shared makes no keys at open, record store or not', async () => {
      const relay = new MemoryTransport();
      const alone = await phone(relay, 'Alone');
      await alone.service.prepare();
      expect(alone.keys.made).not.toHaveBeenCalled();
      expect(alone.service.findings()).toEqual([]);
    });

    it('records the shares made before this build at open, once the check has run', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const { bookId } = await sharedHome(fandri);
      fandri.service.stop();
      await fandri.records.remove(bookId);
      const opened = again(fandri);
      await opened.prepare();
      expect(await fandri.records.get(bookId)).toMatchObject({ bookId });
      expect(opened.findings()).toEqual([]);
    });

    it('Delete of a lost copy erases it and removes its record, read before the rows went', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const { bookId } = await sharedHome(fandri);
      fandri.service.stop();
      await fandri.database.db.run(sql`DELETE FROM shared_books`);
      const opened = again(fandri);
      await opened.prepare();
      // Nothing in the rows says it was shared (no lineage, no share row): it voids like a never-shared one, and the
      // record, which still says so, goes all the same.
      await opened.deleteWorkspace(fandri.ws, bookId);
      expect(await fandri.records.get(bookId)).toBeNull();
      expect(opened.findings()).toEqual([]);
      expect((await fandri.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`)).length).toBe(0);
      expect((await opened.log.forBook(bookId)).map((entry) => entry.op)).toContain('erase');
    });

    it('Leave and delete: the member leaves the share and the copy is erased; Dewi’s purchase kept in Personal by default', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      const dewi = await phone(relay, 'Dewi');
      await fandri.service.start();
      await dewi.service.start();
      const { bookId, invite } = await sharedHome(fandri);
      await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
      await postTransaction(dewi.database, { ...dewi.ws, bookId }, {
        occurredOn: '2026-09-02',
        description: 'Corner bakery',
        lines: expenseLines({ categoryAccountId: await groceries(dewi.database, bookId), paymentAccountId: dewi.bank, amountMinor: 23_400, currency: 'IDR' }),
      });
      await dewi.service.syncNow(bookId);
      const balance = async () => Number((await dewi.database.db.values<[number]>(sql`SELECT COALESCE(SUM(e.amount_minor), 0) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE e.account_id = ${dewi.bank} AND t.status = 'posted'`))[0]![0]);
      expect(await balance()).toBe(-23_400);

      const done = await dewi.service.leaveAndDelete(dewi.ws, bookId);
      expect(done).toMatchObject({ erased: true, keptInPersonal: 1 });
      expect(await balance()).toBe(-23_400);
      expect((await dewi.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`)).length).toBe(0);
      expect(await dewi.records.get(bookId)).toBeNull();
      expect(dewi.service.syncing()).not.toContain(bookId);
      const ops = (await dewi.service.log.forBook(bookId)).map((entry) => entry.op);
      expect(ops).toEqual(expect.arrayContaining(['leave', 'erase']));

      // The owner's next run sees the device gone from the share.
      await fandri.service.syncNow(bookId);
      const detail = (await sharingDetail(fandri.database, bookId, await fandri.service.deviceId()))!;
      expect(detail.members.find((m) => m.name === 'Dewi')!.devices).toHaveLength(0);
      fandri.service.stop();
      dewi.service.stop();
    });

    it('Leave and delete over a purchase split with Personal is refused before the leave: the share stays active (A8 review I-1)', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      const dewi = await phone(relay, 'Dewi');
      await fandri.service.start();
      await dewi.service.start();
      const { bookId, invite } = await sharedHome(fandri);
      await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
      const personalId = (await personalBook(dewi.database, dewi.ws)).id;
      const ownGroceries = await groceries(dewi.database, personalId);
      // One purchase, one part on the copy's category and one on Personal's: a split across workspaces.
      await postTransaction(dewi.database, { ...dewi.ws, bookId: personalId }, {
        occurredOn: '2026-09-03',
        description: 'Market run',
        acrossBooks: true,
        lines: [
          { accountId: await groceries(dewi.database, bookId), amountMinor: 12_300, currency: 'IDR' },
          { accountId: ownGroceries, amountMinor: 4_100, currency: 'IDR' },
          { accountId: dewi.bank, amountMinor: -16_400, currency: 'IDR' },
        ],
      });
      await expect(dewi.service.leaveAndDelete(dewi.ws, bookId)).rejects.toMatchObject({ code: 'SPLIT' });
      expect((await listSharedBooks(dewi.database)).find((b) => b.bookId === bookId)).toMatchObject({ state: 'active' });
      await expect(dewi.service.deleteHereOnly(dewi.ws, bookId)).rejects.toMatchObject({ code: 'SPLIT' });
      expect((await listSharedBooks(dewi.database)).find((b) => b.bookId === bookId)).toMatchObject({ state: 'active' });
      expect(dewi.service.syncing()).toContain(bookId);
      fandri.service.stop();
      dewi.service.stop();
    });

    it('Leave and delete with the relay out of reach changes nothing; Delete here only then erases the copy alone', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      const dewi = await phone(relay, 'Dewi');
      await fandri.service.start();
      await dewi.service.start();
      const { bookId, invite } = await sharedHome(fandri);
      await dewi.service.join(invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
      const relayBookId = (await listSharedBooks(dewi.database))[0]!.relayBookId;
      dewi.failing.add(relayBookId);

      await expect(dewi.service.leaveAndDelete(dewi.ws, bookId)).rejects.toBeInstanceOf(SyncTransportError);
      expect((await dewi.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`)).length).toBe(1);
      expect((await listSharedBooks(dewi.database))[0]).toMatchObject({ bookId, state: 'active' });

      const done = await dewi.service.deleteHereOnly(dewi.ws, bookId);
      expect(done.erased).toBe(true);
      expect((await dewi.database.db.values(sql`SELECT 1 FROM books WHERE id = ${bookId}`)).length).toBe(0);
      expect(await listSharedBooks(dewi.database)).toEqual([]);
      expect(await dewi.records.get(bookId)).toBeNull();
      expect(dewi.service.syncing()).not.toContain(bookId);
      // The relay was not told: the owner still lists Dewi's phone.
      await fandri.service.syncNow(bookId);
      const detail = (await sharingDetail(fandri.database, bookId, await fandri.service.deviceId()))!;
      expect(detail.members.find((m) => m.name === 'Dewi')!.devices).toHaveLength(1);
      fandri.service.stop();
      dewi.service.stop();
    });

    it('Place them now runs in the book’s turn and is logged; with nothing held it places nothing', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const { bookId } = await sharedHome(fandri);
      await expect(fandri.service.placeHeldRows(bookId)).resolves.toEqual({ placed: 0, stillHeld: 0 });
      expect((await fandri.service.log.forBook(bookId)).find((entry) => entry.op === 'place')).toMatchObject({ level: 'info', message: expect.stringMatching(/placed 0/) });
      fandri.service.stop();
    });

    it('an invite beside another copy from the same owner names that copy before the join (D-A7)', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      const dewi = await phone(relay, 'Dewi');
      await fandri.service.start();
      await dewi.service.start();
      const first = await sharedHome(fandri, 'Home');
      await dewi.service.join(first.invite.code, { ws: dewi.ws, memberName: 'Dewi', deviceName: 'iPhone' });
      const second = await sharedHome(fandri, 'Home again');
      const preview = await dewi.service.preview(second.invite.code);
      expect(preview.otherCopies).toEqual([{ bookId: first.bookId, name: 'Home', state: 'active', sharedAt: expect.any(String), joined: true }]);
      // Nothing else on Fandri's own phone is another copy of a book he owns there.
      const own = await fandri.service.preview(first.invite.code).catch(() => null);
      expect(own?.otherCopies ?? []).not.toContainEqual(expect.objectContaining({ bookId: first.bookId }));
      fandri.service.stop();
      dewi.service.stop();
    });

    it('a restore stops every sync and waits for the one running, tells the engine its rows were replaced, and does not start again', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const { bookId } = await sharedHome(fandri);
      const engine = await fandri.service.engine();
      const replaced = vi.spyOn(engine, 'databaseReplaced');
      const backup = await fandri.database.exportBytes();
      const running = fandri.service.syncNow(bookId);
      let syncedDuring = false;
      await fandri.service.whileReplacing(async () => {
        expect(fandri.service.syncing()).toEqual([]);
        const spy = vi.spyOn(engine, 'syncOnce');
        await fandri.service.syncNow(bookId);
        syncedDuring = spy.mock.calls.length > 0;
        await fandri.database.importBytes(backup);
      });
      await running;
      expect(syncedDuring).toBe(false);
      expect(replaced).toHaveBeenCalled();
      await fandri.service.start();
      expect(fandri.service.syncing()).toEqual([]);
      fandri.service.stop();
    });

    it('a restore that fails starts syncing again', async () => {
      const relay = new MemoryTransport();
      const fandri = await phone(relay, 'Fandri');
      await fandri.service.start();
      const { bookId } = await sharedHome(fandri);
      await expect(fandri.service.whileReplacing(async () => Promise.reject(new Error('cancelled')))).rejects.toThrow('cancelled');
      expect(fandri.service.syncing()).toContain(bookId);
      fandri.service.stop();
    });
  });
});
