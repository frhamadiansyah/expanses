import { createDatabase, createWorkspace, MemoryKeyStore, MemoryTransport, migrate, personalBook, requestSignerOf } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { syncConsole } from './sync-console';
import { SyncService } from './sync-service';

vi.setConfig({ testTimeout: 30_000 });

describe('the console helper', () => {
  it('reads the sharing tables and the log, ids only, and writes nothing', async () => {
    const database = createDatabase(createNodeExecutor());
    await migrate(database);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const relay = new MemoryTransport();
    const sync = new SyncService({ database, keyStore: new MemoryKeyStore(), transportFor: (device) => relay.as(requestSignerOf(device)), onError: () => {}, intervalMs: 60 * 60_000 });
    const help = syncConsole(database, sync);
    expect(await help.sharedBooks()).toEqual([]);
    expect(await help.outboxCount()).toBe(0);

    const bookId = (await personalBook(database, ws)).id;
    await sync.start();
    await sync.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    const [row] = await help.sharedBooks();
    expect(row).toMatchObject({ bookId, state: 'active', epoch: 1 });
    expect(await help.bookMembers()).toEqual([{ bookId, memberId: row!.memberId, role: 'owner' }]);
    expect(await help.bookDevices(bookId)).toEqual([{ bookId, deviceId: await sync.deviceId(), memberId: row!.memberId, removed: false, appVersion: expect.any(String) }]);
    expect(await help.outboxCount(bookId)).toBe(0);
    expect(await help.cursor(bookId)).toBeGreaterThan(0);
    expect((await help.log())[0]).toMatchObject({ op: 'share', bookId });
    const text = await help.sharingDetail(bookId);
    expect(text).toContain('State active');
    expect(JSON.stringify([await help.sharedBooks(), await help.bookMembers(), await help.bookDevices(), text])).not.toMatch(/Fandri|Mac|Personal/);
    sync.stop();
  });
});
