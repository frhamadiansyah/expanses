import { SharingError, SyncTransportError } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { cleanMessage, describeError, firstFrame, formatSyncLogEntry, memorySyncLogStore, SYNC_LOG_FIELDS, SYNC_LOG_KEEP, SyncLog, type SyncLogOp } from './sync-log';

const clock = () => {
  let ms = Date.parse('2026-11-11T08:00:00.000Z');
  return () => new Date((ms += 1000));
};

describe('the sync log', () => {
  it('keeps the newest fifty, newest first', async () => {
    const log = new SyncLog(memorySyncLogStore(), clock());
    for (let i = 1; i <= SYNC_LOG_KEEP + 7; i += 1) await log.record({ op: 'sync', bookId: 'book-1', error: new Error(`run ${i}`) });
    const entries = await log.entries();
    expect(entries).toHaveLength(50);
    expect(entries[0]!.message).toBe('run 57');
    expect(entries[49]!.message).toBe('run 8');
  });

  it('survives a reload: a new log over the same store reads what the old one wrote', async () => {
    const store = memorySyncLogStore();
    const before = new SyncLog(store, clock());
    await before.record({ op: 'share', bookId: 'book-1', relayBookId: '01a1c883-e4c0-795e', message: 'Sent 12 ops' });
    await before.record({ op: 'drain', bookId: 'book-1', error: new SyncTransportError(503, 'relay unavailable'), state: 'waiting 3' });
    const after = new SyncLog(store, clock());
    const entries = await after.entries();
    expect(entries.map((entry) => entry.op)).toEqual(['drain', 'share']);
    expect(entries[0]).toMatchObject({ level: 'error', name: 'SyncTransportError', status: 503, message: 'relay unavailable', state: 'waiting 3' });
    expect(entries[1]).toMatchObject({ level: 'info', relayBookId: '01a1c883', message: 'Sent 12 ops' });
  });

  it('records in order even when entries come at once, and a store that will not write keeps the log in memory', async () => {
    const failing = { read: async () => null, write: async () => Promise.reject(new Error('NoModificationAllowedError')) };
    const log = new SyncLog(failing, clock());
    await Promise.all([1, 2, 3].map((i) => log.record({ op: 'sync', bookId: 'b', error: new Error(`e${i}`) })));
    expect((await log.entries()).map((entry) => entry.message)).toEqual(['e3', 'e2', 'e1']);
  });

  it('reads a broken file as an empty log', async () => {
    const log = new SyncLog(memorySyncLogStore(new TextEncoder().encode('{nope')));
    expect(await log.entries()).toEqual([]);
  });

  it('gives one book its own entries and the device-wide ones', async () => {
    const log = new SyncLog(memorySyncLogStore(), clock());
    await log.record({ op: 'sync', bookId: 'a', error: new Error('a') });
    await log.record({ op: 'prepare', error: new Error('keys') });
    await log.record({ op: 'sync', bookId: 'b', error: new Error('b') });
    expect((await log.forBook('a')).map((entry) => entry.message)).toEqual(['keys', 'a']);
  });

  it('stores exactly its fields, and none of what a failed query or a key would carry', async () => {
    const store = memorySyncLogStore();
    const log = new SyncLog(store, clock());
    const query = new Error('Failed query: INSERT INTO transactions (id, description, amount) values (?, ?, ?)\nparams: t1,Dinner at the corner,125000', {
      cause: new Error('UNIQUE constraint failed: transactions.id'),
    });
    await log.record({ op: 'apply', bookId: 'book-1', error: query, state: 'up_to_date' });
    await log.record({ op: 'invite', bookId: 'book-1', error: new Error(`bad key ${'k'.repeat(64)}`) });
    await log.record({ op: 'join', error: new SharingError('INVITE_CLAIMED', 'Someone has already used this invite') });
    const written = new TextDecoder().decode(store.bytes!);
    expect(written).not.toMatch(/Dinner|125000|params|kkkkkkkkkk/);
    const entries = JSON.parse(written) as Record<string, unknown>[];
    for (const entry of entries) expect(Object.keys(entry).sort()).toEqual([...SYNC_LOG_FIELDS].sort());
    expect(entries[2]!.message).toContain('UNIQUE constraint failed: transactions.id');
    expect(entries[0]).toMatchObject({ code: 'INVITE_CLAIMED', name: 'SharingError', bookId: null });
  });
});

describe('the sync log under a flood', () => {
  it('counts the same failure again into one entry, with when it first and last happened', async () => {
    const log = new SyncLog(memorySyncLogStore(), clock());
    for (let i = 0; i < 200; i += 1) await log.record({ op: 'sync', bookId: 'b', relayBookId: 'r-1', error: new SyncTransportError(0, 'Load failed'), state: `waiting ${i}` });
    const [entry, ...rest] = await log.entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ op: 'sync', count: 200, firstAt: '2026-11-11T08:00:01.000Z', at: '2026-11-11T08:03:20.000Z', state: 'waiting 199' });
    expect(formatSyncLogEntry(entry!)).toContain('200 times since 2026-11-11T08:00:01.000Z');
  });

  it('counts each of two alternating failures, and keeps a different book or op apart', async () => {
    const log = new SyncLog(memorySyncLogStore(), clock());
    for (let i = 0; i < 10; i += 1) {
      await log.record({ op: 'sync', bookId: 'a', error: new Error('Load failed') });
      await log.record({ op: 'pull', bookId: 'a', message: 'pull stopped at seq 41: gap' });
    }
    await log.record({ op: 'sync', bookId: 'b', error: new Error('Load failed') });
    await log.record({ op: 'sync', bookId: 'a', error: new Error('The network connection was lost.') });
    const entries = await log.entries();
    expect(entries.map((entry) => [entry.op, entry.bookId, entry.message, entry.count])).toEqual([
      ['sync', 'a', 'The network connection was lost.', 1],
      ['sync', 'b', 'Load failed', 1],
      ['pull', 'a', 'pull stopped at seq 41: gap', 10],
      ['sync', 'a', 'Load failed', 10],
    ]);
  });

  it('keeps the one-off acts however many background entries come after them', async () => {
    const store = memorySyncLogStore();
    const log = new SyncLog(store, clock());
    const oneOff: [SyncLogOp, string][] = [
      ['share', 'Shared: seeded, 40 ops in 2 entries sent, 0 ops left in the outbox'],
      ['invite', 'Invite made'],
      ['join', 'Joined: 40 applied, 0 refused'],
      ['restore', 'Moved to needs_invite at open'],
      ['stop', 'Stopped sharing'],
      ['leave', 'Left'],
    ];
    for (const [op, message] of oneOff) await log.record({ op, bookId: 'b', message });
    for (let i = 0; i < 300; i += 1) await log.record({ op: i % 2 ? 'sync' : 'apply', bookId: 'b', error: new Error(`failure ${i}`) });
    const entries = await new SyncLog(store, clock()).entries();
    expect(entries.filter((entry) => entry.op === 'sync' || entry.op === 'apply')).toHaveLength(SYNC_LOG_KEEP);
    expect(entries.filter((entry) => !['sync', 'apply'].includes(entry.op)).map((entry) => entry.op)).toEqual(oneOff.map(([op]) => op).reverse());
    // Newest first across both lists.
    expect(entries[0]!.message).toBe('failure 299');
  });

  it('keeps at most fifty one-off entries too', async () => {
    const log = new SyncLog(memorySyncLogStore(), clock());
    for (let i = 0; i < 70; i += 1) await log.record({ op: 'join', error: new Error(`claim ${i}`) });
    const entries = await log.entries();
    expect(entries).toHaveLength(SYNC_LOG_KEEP);
    expect(entries.at(-1)!.message).toBe('claim 20');
  });

  it('reads a file written before entries were counted as entries seen once', async () => {
    const old = [{ at: '2026-11-10T01:00:00.000Z', level: 'error', op: 'sync', bookId: 'b', relayBookId: null, name: 'Error', message: 'Load failed', code: null, status: null, frame: null, state: null }];
    const log = new SyncLog(memorySyncLogStore(new TextEncoder().encode(JSON.stringify(old))), clock());
    expect((await log.entries())[0]).toMatchObject({ count: 1, firstAt: '2026-11-10T01:00:00.000Z' });
    await log.record({ op: 'sync', bookId: 'b', error: new Error('Load failed') });
    expect(await log.entries()).toMatchObject([{ count: 2, firstAt: '2026-11-10T01:00:00.000Z', at: '2026-11-11T08:00:01.000Z' }]);
  });
});

describe('an error as the log words it', () => {
  it('cuts what a query appends and anything key-sized, and caps the length', () => {
    expect(cleanMessage('Failed query: SELECT 1\nparams: 5,secret')).toBe('Failed query: SELECT 1');
    expect(cleanMessage(`x ${'A'.repeat(43)} y`)).toBe('x […] y');
    expect(cleanMessage('z'.repeat(39))).toHaveLength(39);
    expect(cleanMessage('w '.repeat(400)).length).toBeLessThanOrEqual(300);
  });

  it('takes the first frame of a Chrome or a Safari stack, without the host', () => {
    expect(firstFrame('Error: boom\n    at runOnce (http://localhost:5173/src/sync/sync-service.ts?t=1:470:7)\n    at x', 'boom')).toBe('runOnce (src/sync/sync-service.ts:470:7)');
    expect(firstFrame('runOnce@capacitor://localhost/assets/index-abc.js:1:2345\nx@y', 'boom')).toBe('runOnce@assets/index-abc.js:1:2345');
    expect(firstFrame(undefined, 'boom')).toBeNull();
  });

  it('words what is not an Error at all', () => {
    expect(describeError('offline')).toMatchObject({ name: 'string', message: 'offline' });
    expect(describeError({ status: 500 })).toMatchObject({ name: 'object', message: '{"status":500}' });
    expect(describeError(new Error(''))).toMatchObject({ message: '(no message)' });
  });

  it('puts an entry on one line', async () => {
    const log = new SyncLog(memorySyncLogStore(), () => new Date('2026-11-11T08:00:00.000Z'));
    await log.record({ op: 'sync', bookId: 'b1c2d3e4-0000', relayBookId: '9f8e7d6c-1111', error: new SyncTransportError(0, 'relay unreachable'), state: 'stale 2' });
    const [entry] = await log.entries();
    expect(formatSyncLogEntry({ ...entry!, frame: null })).toBe('2026-11-11T08:00:00.000Z sync (book b1c2d3e4 relay 9f8e7d6c) · SyncTransportError 0: relay unreachable · state stale 2');
  });
});
