import { createDatabase, createWorkspace, MemoryKeyStore, MemoryTransport, migrate, personalBook, requestSignerOf } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/pwa', () => ({ isNative: () => false }));

import { SyncService } from '../../sync/sync-service';
import { collectSyncDetails, detailsStateOf, SYNC_DETAILS_FOOTER, type SyncDetails, syncDetailsText } from './sync-details';

vi.setConfig({ testTimeout: 30_000 });

const base: SyncDetails = {
  takenAt: '2026-11-11T08:00:00.000Z',
  app: '0.5.0 (108)',
  bookId: 'b1c2d3e4-aaaa-bbbb-cccc-000000000001',
  state: 'active',
  engineStatus: 'waiting 3',
  diag: {
    shared: {
      relayBookId: '9f8e7d6c-1111-2222-3333-444444444444',
      epoch: 2,
      memberId: 'a1b2c3d4-5555',
      state: 'active',
      sharedAt: '2026-10-01T00:00:00.000Z',
      syncedAt: '2026-11-11T07:58:00.000Z',
      unsharedBy: null,
      unsharedReason: null,
    },
    outbox: 3,
    cursor: 120,
    members: [
      { memberId: 'a1b2c3d4-5555', role: 'owner' },
      { memberId: 'e5f6a7b8-6666', role: 'member' },
    ],
    devices: [
      { deviceId: '5e6f7a8b9c', memberId: 'a1b2c3d4-5555', removed: false },
      { deviceId: '0a1b2c3d4e', memberId: 'e5f6a7b8-6666', removed: true },
    ],
    epochKeys: [1, 2],
    skipped: { count: 0, entities: [] },
  },
  deviceId: '5e6f7a8b9c',
  hasKeys: true,
  deviceRow: 'yes',
  epochKey: 'opens',
  live: { polled: true, running: false, failing: true, lastSyncedAt: Date.parse('2026-11-11T07:58:00.000Z'), lastError: 'SyncTransportError 503: unavailable' },
  log: [
    {
      at: '2026-11-11T07:59:00.000Z',
      level: 'error',
      op: 'sync',
      bookId: 'b1c2d3e4-aaaa-bbbb-cccc-000000000001',
      relayBookId: '9f8e7d6c',
      name: 'SyncTransportError',
      message: 'unavailable',
      code: null,
      status: 503,
      frame: null,
      state: 'waiting 3',
      count: 1,
      firstAt: '2026-11-11T07:59:00.000Z',
    },
  ],
};

describe('the details footer', () => {
  it('says names can appear in error messages, and never claims there are none', () => {
    expect(SYNC_DETAILS_FOOTER).toMatch(/error message can name a workspace, an event or a person/);
    expect(SYNC_DETAILS_FOOTER).not.toMatch(/no names/i);
    expect(SYNC_DETAILS_FOOTER).not.toMatch(/\byou(r)?\b/i);
  });
});

describe('the details text', () => {
  it('says every part on its own line, ids cut to eight', () => {
    expect(syncDetailsText(base)).toBe(
      [
        'Expanses sync details',
        'Taken 2026-11-11T08:00:00.000Z',
        'App 0.5.0 (108)',
        'Workspace b1c2d3e4',
        'State active · engine waiting 3',
        'Relay book 9f8e7d6c · epoch 2 · member a1b2c3d4 · row active',
        'Shared at 2026-10-01T00:00:00.000Z · synced at 2026-11-11T07:58:00.000Z',
        'Outbox 3 · cursor 120 · refused ops 0',
        'Members 2 (owners 1) · devices 2 (removed 1) · epoch keys 1, 2',
        'This device 5e6f7a8b · keys yes · device row yes · epoch key opens',
        'This session: polled yes · running no · failing yes · last run 2026-11-11T07:58:00.000Z',
        'Last error SyncTransportError 503: unavailable',
        '',
        'Log, newest first (1)',
        '2026-11-11T07:59:00.000Z sync (book b1c2d3e4 relay 9f8e7d6c) · SyncTransportError 503: unavailable · state waiting 3',
      ].join('\n'),
    );
  });

  it('says plainly when the book has no shared_books row and nothing was logged', () => {
    const text = syncDetailsText({ ...base, state: 'none', engineStatus: 'none', diag: { ...base.diag, shared: null, devices: [], members: [], epochKeys: [], outbox: 0, cursor: null }, log: [], live: { ...base.live, failing: false, lastError: null } });
    expect(text).toContain('State none · engine none');
    expect(text).toContain('Relay book none: no shared_books row on this device');
    expect(text).toContain('Outbox 0 · cursor none');
    expect(text).toContain('Log: nothing recorded on this device');
    expect(text).not.toContain('Shared at');
    expect(text).not.toContain('Last error');
  });

  it('names how an ended share ended', () => {
    const shared = { ...base.diag.shared!, state: 'unshared' as const, unsharedBy: 'a1b2c3d4-5555', unsharedReason: 'stopped' };
    expect(syncDetailsText({ ...base, state: 'unshared', diag: { ...base.diag, shared } })).toContain('Ended stopped by a1b2c3d4');
  });

  it('puts the book in one word: none, the row’s own state, or frozen and stale from the engine', () => {
    const row = base.diag.shared!;
    expect(detailsStateOf(null, null)).toBe('none');
    expect(detailsStateOf({ ...row, state: 'needs_invite' }, null)).toBe('needs_invite');
    expect(detailsStateOf({ ...row, state: 'unshared' }, null)).toBe('unshared');
    expect(detailsStateOf(row, { state: 'frozen', changes: 0, syncedAt: null })).toBe('frozen');
    expect(detailsStateOf(row, { state: 'stale', since: row.syncedAt!, changes: 1 })).toBe('stale');
    expect(detailsStateOf(row, { state: 'up_to_date', syncedAt: null })).toBe('active');
  });
});

describe('reading the details', () => {
  async function phone() {
    const database = createDatabase(createNodeExecutor());
    await migrate(database);
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const relay = new MemoryTransport();
    const keyStore = new MemoryKeyStore();
    const sync = new SyncService({ database, keyStore, transportFor: (device) => relay.as(requestSignerOf(device)), onError: () => {}, intervalMs: 60 * 60_000 });
    const bookId = (await personalBook(database, ws)).id;
    return { database, sync, keyStore, bookId };
  }

  it('makes no keys for a book never shared, and says none', async () => {
    const { database, sync, keyStore, bookId } = await phone();
    const details = await collectSyncDetails({ database, sync, bookId, build: null });
    expect(details).toMatchObject({ state: 'none', deviceId: null, hasKeys: false, deviceRow: 'unknown', epochKey: 'unknown', engineStatus: 'no engine on this device yet' });
    expect(details.app).toMatch(/\(web\)$/);
    expect(await keyStore.hasDevice()).toBe(false);
  });

  it('reads a shared book whole, and still the log once its shared_books row is gone', async () => {
    const { database, sync, bookId } = await phone();
    await sync.start();
    await sync.share(bookId, { memberName: 'Fandri', deviceName: 'Mac' });
    const shared = await collectSyncDetails({ database, sync, bookId, build: '0.5.0 (108)' });
    expect(shared).toMatchObject({ state: 'active', engineStatus: 'up_to_date', deviceRow: 'yes', epochKey: 'opens', hasKeys: true, app: '0.5.0 (108)' });
    expect(shared.log[0]).toMatchObject({ level: 'info', op: 'share' });
    expect(syncDetailsText(shared)).not.toMatch(/Fandri|Mac|Personal/);

    await database.db.run(sql`DELETE FROM shared_books WHERE book_id = ${bookId}`);
    const orphan = await collectSyncDetails({ database, sync, bookId, build: null });
    expect(orphan.state).toBe('none');
    expect(orphan.engineStatus).toBe('none');
    expect(orphan.epochKey).toBe('unknown');
    expect(orphan.deviceRow).toBe('yes');
    expect(orphan.log.length).toBeGreaterThan(0);
    sync.stop();
  });
});
