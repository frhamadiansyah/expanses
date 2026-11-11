import { createDatabase } from '@expanses/db';
import { createNodeExecutor, type NodeExecutor } from '@expanses/db/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RestoreCancelledError, restoreSharingCheck, restoreSharingMessage, type SharedWorkspace, sharedWorkspacesInBytes, sharingGate } from './restore-sharing';
import { memorySnapshots, restoreSnapshot } from './snapshots';

const engines: NodeExecutor[] = [];
afterEach(() => {
  while (engines.length) engines.pop()!.close();
});

const home: SharedWorkspace = { bookId: 'b-home', name: 'Home', state: 'active' };
const trip: SharedWorkspace = { bookId: 'b-trip', name: 'Trip', state: 'active' };

/** A database file holding `books` and, unless `before`, `shared_books`, with these rows. */
async function file(shared: SharedWorkspace[], options: { before?: boolean; books?: string[] } = {}): Promise<Uint8Array> {
  const engine = createNodeExecutor();
  engines.push(engine);
  const db = createDatabase(engine);
  await db.execScript('CREATE TABLE books (id TEXT PRIMARY KEY, name TEXT NOT NULL);');
  if (!options.before) await db.execScript('CREATE TABLE shared_books (book_id TEXT PRIMARY KEY, state TEXT NOT NULL);');
  for (const name of options.books ?? []) await db.execScript(`INSERT INTO books VALUES ('b-${name.toLowerCase()}', '${name}');`);
  for (const book of shared) {
    await db.execScript(`INSERT OR IGNORE INTO books VALUES ('${book.bookId}', '${book.name}'); INSERT INTO shared_books VALUES ('${book.bookId}', '${book.state}');`);
  }
  return db.exportBytes();
}

describe('what a restore does to the workspaces shared here', () => {
  it('is the same when the copy shares what is shared here, or nothing is shared here', () => {
    expect(restoreSharingCheck([home], [home])).toEqual({ kind: 'same' });
    expect(restoreSharingCheck([], [])).toEqual({ kind: 'same' });
    expect(restoreSharingCheck([], null)).toEqual({ kind: 'same' });
    // Ended here: a copy without it loses nothing.
    expect(restoreSharingCheck([{ ...home, state: 'unshared' }], [])).toEqual({ kind: 'same' });
    // A copy that shares more than is shared here takes nothing away.
    expect(restoreSharingCheck([home], [home, trip])).toEqual({ kind: 'same' });
  });

  it('names a workspace shared here that the copy lacks, or holds in another state', () => {
    expect(restoreSharingCheck([home, trip], [{ ...trip, state: 'needs_invite' }])).toEqual({
      kind: 'differs',
      workspaces: [
        { name: 'Home', here: 'active', inCopy: null },
        { name: 'Trip', here: 'active', inCopy: 'needs_invite' },
      ],
    });
  });

  it('says it cannot check when either side cannot be read', () => {
    expect(restoreSharingCheck(null, [home])).toEqual({ kind: 'unknown', side: 'here' });
    expect(restoreSharingCheck([home], null)).toEqual({ kind: 'unknown', side: 'copy' });
  });

  it('words the warning by name, without "you", and asks', () => {
    const said = restoreSharingMessage(restoreSharingCheck([home, trip], [{ ...trip, state: 'unshared' }]))!;
    expect(said).toBe(
      'Home is shared here but not in this copy. Restoring it disconnects Home from the people it is shared with.\n\n' +
        'Trip is shared here but no longer shared in this copy. Restoring it can disconnect Trip from the people it is shared with.\n\n' +
        'Restore anyway?',
    );
    expect(restoreSharingMessage({ kind: 'unknown', side: 'here' })).toMatch(/^Sharing cannot be checked: the data on this device cannot be read\./);
    expect(restoreSharingMessage({ kind: 'same' })).toBeNull();
    for (const check of [restoreSharingCheck([home], []), { kind: 'unknown', side: 'here' } as const, { kind: 'unknown', side: 'copy' } as const]) {
      expect(restoreSharingMessage(check)).not.toMatch(/\byou(r)?\b/i);
    }
  });
});

describe('reading the shared workspaces out of a database file', () => {
  it('reads them by name, none from a file older than sharing, and null from bytes that are no database', async () => {
    expect(await sharedWorkspacesInBytes(await file([home, { ...trip, state: 'needs_invite' }], { books: ['Business'] }))).toEqual([
      home,
      { ...trip, state: 'needs_invite' },
    ]);
    expect(await sharedWorkspacesInBytes(await file([], { before: true, books: ['Home'] }))).toEqual([]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await sharedWorkspacesInBytes(new TextEncoder().encode('not a database at all, not even close'))).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('the gate before a restore', () => {
  it('asks only when the copy would disconnect a workspace, and Cancel calls the restore off before anything is replaced', async () => {
    const live = await file([home]);
    const older = await file([], { books: ['Home'] });
    const asked: string[] = [];
    const cancel = sharingGate((message) => (asked.push(message), false));
    expect(await sharingGate(() => false)({ live: await file([]), chosen: older })).toBe(true);
    expect(await sharingGate(() => false)({ live, chosen: live })).toBe(true);

    const files = new Map<string, Uint8Array>();
    const snapshots = memorySnapshots(files);
    const kept = await snapshots.write(older, 'daily', 108);
    const restore = vi.fn(async () => undefined);
    const marked = vi.spyOn(snapshots, 'markImport');
    await expect(restoreSnapshot({ snapshots, file: kept.file, live: async () => live, restore, checkSharing: cancel })).rejects.toBeInstanceOf(RestoreCancelledError);
    expect(asked).toEqual(['Home is shared here but not in this copy. Restoring it disconnects Home from the people it is shared with.\n\nRestore anyway?']);
    expect(restore).not.toHaveBeenCalled();
    // No before-restore copy either: nothing was started.
    expect((await snapshots.list()).map((copy) => copy.reason)).toEqual(['daily']);
    // And no note of a restore in progress, which the next launch would act on.
    expect(marked).not.toHaveBeenCalled();
    expect(await snapshots.importMarker!()).toBeNull();

    // Restore anyway: it goes ahead as before.
    await restoreSnapshot({ snapshots, file: kept.file, live: async () => live, restore, checkSharing: sharingGate(() => true) });
    expect(restore).toHaveBeenCalledOnce();
  });

  it('says sharing cannot be checked when the data here is there but cannot be read', async () => {
    const asked: string[] = [];
    const gate = sharingGate((message) => (asked.push(message), true));
    const chosen = await file([]);
    expect(await gate({ live: null, chosen, liveFailed: true })).toBe(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await gate({ live: new TextEncoder().encode('not a database, only the shape of one'), chosen })).toBe(true);
    vi.restoreAllMocks();
    expect(asked).toHaveLength(2);
    for (const message of asked) expect(message).toMatch(/^Sharing cannot be checked: the data on this device cannot be read/);
  });

  it('asks nothing when there is no database here at all', async () => {
    const ask = vi.fn(() => false);
    expect(await sharingGate(ask)({ live: null, chosen: await file([], { books: ['Home'] }) })).toBe(true);
    expect(await sharingGate(ask)({ live: new Uint8Array(0), chosen: await file([]), liveFailed: false })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('is told by the restore whether the live bytes could not be read, and a cancel then still leaves nothing behind', async () => {
    const snapshots = memorySnapshots();
    const kept = await snapshots.write(await file([]), 'daily', 108);
    const sides: { live: Uint8Array | null; liveFailed: boolean }[] = [];
    const checkSharing = async (seen: { live: Uint8Array | null; chosen: Uint8Array; liveFailed: boolean }) => (sides.push({ live: seen.live, liveFailed: seen.liveFailed }), false);
    const restore = vi.fn(async () => undefined);
    const failing = async () => Promise.reject(new Error('NotReadableError'));
    await expect(restoreSnapshot({ snapshots, file: kept.file, live: failing, restore, checkSharing })).rejects.toBeInstanceOf(RestoreCancelledError);
    await expect(restoreSnapshot({ snapshots, file: kept.file, live: async () => null, restore, checkSharing })).rejects.toBeInstanceOf(RestoreCancelledError);
    expect(sides).toEqual([
      { live: null, liveFailed: true },
      { live: null, liveFailed: false },
    ]);
    expect(restore).not.toHaveBeenCalled();
    expect(await snapshots.importMarker!()).toBeNull();
    expect(await snapshots.list()).toHaveLength(1);
  });
});
