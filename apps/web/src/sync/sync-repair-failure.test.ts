import { createAccount, createDatabase, createWorkspace, MemoryKeyStore, MemoryShareRecordStore, MemoryTransport, migrate, personalBook, requestSignerOf } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));
// The repair throws every time: the sync must go on regardless, and say so in the log.
vi.mock('@expanses/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@expanses/db')>()),
  runSharedBookRepairs: vi.fn(() => Promise.reject(new Error('repair failed for the test'))),
}));

import { SyncService } from './sync-service';

vi.setConfig({ testTimeout: 30_000 });

describe('a one-time repair that fails (sync gaps)', () => {
  it('never fails the sync; it is a line in the log, and is tried again on the next run', async () => {
    const relay = new MemoryTransport();
    const database = createDatabase(createNodeExecutor());
    await migrate(database);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
    const errors = vi.fn();
    const service = new SyncService({
      database,
      keyStore: new MemoryKeyStore(),
      shareRecords: new MemoryShareRecordStore(),
      transportFor: (device) => relay.as(requestSignerOf(device)),
      onError: errors,
      intervalMs: 60 * 60_000,
    });
    await service.start();
    const bookId = (await personalBook(database, ws)).id;
    await service.share(bookId, { memberName: 'Rina', deviceName: 'Phone' });
    await service.syncNow(bookId);
    expect(service.status(bookId)).toMatchObject({ failing: false, lastSyncedAt: expect.any(Number) });
    await service.syncNow(bookId);
    const lines = (await service.log.forBook(bookId)).filter((entry) => entry.op === 'repair');
    // The same failure again is one line, counted.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'error', message: 'repair failed for the test' });
    expect(lines[0]!.count).toBeGreaterThanOrEqual(2);
    expect(service.status(bookId).failing).toBe(false);
    service.stop();
  });
});
