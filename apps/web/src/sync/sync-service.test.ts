import { expenseLines } from '@expanses/core';
import {
  createAccount,
  createDatabase,
  createWorkspace,
  type Database,
  type DeviceKeys,
  devicesSeen,
  listSharedBooks,
  MemoryKeyStore,
  MemoryTransport,
  migrate,
  personalBook,
  postTransaction,
  requestSignerOf,
  sharingDetail,
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
  const transports = vi.fn((device: DeviceKeys): SyncTransport => relay.as(requestSignerOf(device)));
  const service = new SyncService({ database, keyStore: keys, transportFor: transports, onApplied: applied, onError: () => {}, intervalMs: 60 * 60_000 });
  return { database, ws, bank: bank.id, service, applied, transports, keys };
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

  it('notes when this device was last heard from only once it has moved by more than a minute (final review, minor 4)', async () => {
    const relay = new MemoryTransport();
    const fandri = await phone(relay, 'Fandri');
    // A clock ahead of the wall clock, so the entries this device pulls back (stamped by capture at wall time) never
    // count as heard later than the run itself.
    let now = Date.now() + 60 * 60_000;
    const service = new SyncService({ database: fandri.database, keyStore: fandri.keys, transportFor: fandri.transports, onError: () => {}, now: () => now, intervalMs: 60 * 60_000 });
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
    const again = new SyncService({ database: fandri.database, keyStore: fandri.keys, transportFor: fandri.transports, onError: () => {} });
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

    // The relay comes back: the next run sends it all, and Invite someone works.
    down = false;
    await flaky.syncNow(bookId);
    expect((await sharingDetail(fandri.database, bookId, await flaky.deviceId()))!.waiting).toBe(0);
    await expect(flaky.invite(bookId, 'Fandri')).resolves.toMatchObject({ code: expect.any(String) });
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
});
