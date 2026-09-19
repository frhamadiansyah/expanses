import { describe, expect, it } from 'vitest';
import { MID_SESSION_NOTE, recoveryCopy } from '../features/recovery/recovery-copy';
import { fatalKind, fatalReason } from './fatal';
import { NEWER_DATABASE } from './newer-database';

describe('what counts as a failure the session cannot carry on past', () => {
  it('reads SQLite saying the bytes themselves are wrong', () => {
    // The three sentences SQLite actually produces for SQLITE_CORRUPT and SQLITE_NOTADB, and the result
    // codes sqlite-wasm sometimes hands back instead of them.
    expect(fatalKind(new Error('database disk image is malformed'))).toBe('corrupt');
    expect(fatalKind(new Error('malformed database schema (entries) - near "": syntax error'))).toBe('corrupt');
    expect(fatalKind(new Error('file is not a database'))).toBe('corrupt');
    expect(fatalKind('SQLITE_CORRUPT: sqlite3 result code 11')).toBe('corrupt');
    expect(fatalKind(new Error('SQLITE_NOTADB'))).toBe('corrupt');
    // Drizzle wraps the driver's error; the sentence is still in there.
    expect(fatalKind(new Error('Failed query: select * from entries\nparams: \ndatabase disk image is malformed'))).toBe('corrupt');
  });

  it('reads SQLite saying it could not reach them at all', () => {
    expect(fatalKind(new Error('disk I/O error'))).toBe('unreadable');
    expect(fatalKind(new Error('SQLITE_IOERR_READ'))).toBe('unreadable');
    expect(fatalKind(new Error('unable to open database file'))).toBe('unreadable');
    expect(fatalKind(new Error('DB has been closed'))).toBe('unreadable');
    // What the browser throws when it has taken the origin's storage back underneath a live handle.
    expect(fatalKind(new Error("Failed to execute 'read' on 'FileSystemSyncAccessHandle': InvalidStateError"))).toBe('unreadable');
    expect(fatalKind(new Error('NotFoundError: A requested file or directory could not be found'))).toBe('unreadable');
  });

  it('leaves every ordinary failure alone, because this one takes the app away from the user', () => {
    expect(fatalKind(new Error('UNIQUE constraint failed: accounts.id'))).toBeNull();
    expect(fatalKind(new Error('no such column: entries.settled_at'))).toBeNull();
    expect(fatalKind(new Error('FOREIGN KEY constraint failed'))).toBeNull();
    // Contention passes on its own, and the snapshot op's own refusal is a retry, never a recovery screen.
    expect(fatalKind(new Error('database is locked'))).toBeNull();
    expect(fatalKind(new Error('busy'))).toBeNull();
    // The two markers this app throws itself, either of which would be a disaster to read as corruption:
    // one is a file the user picked, the other a copy from a newer build. Both leave the data untouched.
    expect(fatalKind(new Error('That file is not an Expanses backup.'))).toBeNull();
    expect(fatalKind(new Error(`${NEWER_DATABASE}999`))).toBeNull();
    expect(fatalKind(new Error('That copy did not check out: *** in database main ***'))).toBeNull();
  });
});

describe('the reason a mid-session failure is shown as', () => {
  it('names itself as mid-session, keeps the technical text where it belongs, and still offers the bytes', () => {
    const reason = fatalReason('corrupt', 'database disk image is malformed');
    expect(reason.kind).toBe('corrupt');
    expect(reason.midSession).toBe(true);
    // Exportable is not optimism: the recovery screen reads the VFS slot files straight off OPFS.
    expect(reason.exportable).toBe(true);
    expect(reason.detail).toBe('database disk image is malformed');
  });

  /*
   * The words a person reads are `recoveryCopy`'s, never `reason.headline` — which is a log line the screen
   * does not render, the same as every headline `open.ts` builds. Asserted here against the copy that is
   * actually drawn, so these rules are pinned where they can be broken rather than on a string nobody sees.
   */
  it('reaches the user as the mid-session copy, for both kinds', () => {
    for (const kind of ['corrupt', 'unreadable'] as const) {
      const copy = recoveryCopy(fatalReason(kind, 'database disk image is malformed'), { hasSnapshot: true });
      expect(copy.body.startsWith(MID_SESSION_NOTE)).toBe(true);
      expect(copy.body).toContain('not your money');
      // Never alarming, never an instruction to delete anything, and never the engine's own words up front.
      expect(copy.headline).not.toMatch(/malformed|SQLITE/);
      expect(copy.body).not.toMatch(/delete|reinstall|corrupt/i);
      expect(copy.actions).toEqual(['export', 'restore', 'retry', 'start-fresh']);
    }
    expect(recoveryCopy(fatalReason('unreadable', 'disk I/O error'), { hasSnapshot: true }).headline).toBe('Your data stopped answering');
  });
});
