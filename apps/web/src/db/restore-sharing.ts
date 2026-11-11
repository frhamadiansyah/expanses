/*
 * Before a restore replaces the live database: does the copy know about the workspaces this device shares?
 *
 * A copy taken before a workspace was shared has no `shared_books` row for it. Put back, the workspace is an
 * ordinary one again here, while the people it is shared with go on as if this device were still in it — the
 * restore incident of November 2026, which this exists to stop happening silently. So the live database's shared
 * workspaces are compared with the copy's, and any the copy lacks (or holds in another state) are named before
 * anything is replaced. A live database that cannot be read (the recovery screen's case) cannot be compared; that is
 * said too.
 *
 * Both sides are read from bytes, in a throwaway in-memory database on the main thread, so the check works the same
 * on the recovery screen, where the app's own engine is the thing that will not start.
 */

/** A workspace this database shares, as the warning names it. */
export interface SharedWorkspace {
  bookId: string;
  name: string;
  state: 'active' | 'needs_invite' | 'unshared' | string;
}

export type RestoreSharingCheck =
  | { kind: 'same' }
  | { kind: 'differs'; workspaces: { name: string; here: string; inCopy: string | null }[] }
  | { kind: 'unknown'; side: 'here' | 'copy' };

/** Shared workspaces only: a shared event's or a net-worth group log's row has no `books` row to name it by. */
export const SHARED_WORKSPACES_SQL = 'SELECT s.book_id, s.state, b.name FROM shared_books s JOIN books b ON b.id = s.book_id ORDER BY b.name, s.book_id';

/**
 * What changes for the workspaces shared here if `copy` replaces `here`. `null` on a side means it could not be read.
 * A workspace that ended here (`unshared`) loses nothing by a copy without it, so it is not named.
 */
export function restoreSharingCheck(here: readonly SharedWorkspace[] | null, copy: readonly SharedWorkspace[] | null): RestoreSharingCheck {
  if (here === null) return { kind: 'unknown', side: 'here' };
  const ending = here.filter((book) => book.state !== 'unshared');
  if (ending.length === 0) return { kind: 'same' };
  if (copy === null) return { kind: 'unknown', side: 'copy' };
  const workspaces = ending.flatMap((book) => {
    const there = copy.find((other) => other.bookId === book.bookId);
    return there && there.state === book.state ? [] : [{ name: book.name, here: book.state, inCopy: there?.state ?? null }];
  });
  return workspaces.length === 0 ? { kind: 'same' } : { kind: 'differs', workspaces };
}

const stateWords = (state: string): string =>
  state === 'active' ? 'shared' : state === 'needs_invite' ? 'waiting for a new invite' : state === 'unshared' ? 'no longer shared' : state;

/** The confirm's words, or null when there is nothing to say. Impersonal: names the workspaces, never "you". */
export function restoreSharingMessage(check: RestoreSharingCheck): string | null {
  if (check.kind === 'same') return null;
  if (check.kind === 'unknown') {
    return check.side === 'here'
      ? 'Sharing cannot be checked: the data on this device cannot be read. If a workspace here is shared, restoring an older copy can disconnect it from the people it is shared with.\n\nRestore anyway?'
      : 'Sharing cannot be checked: this copy cannot be read for it. Restoring it can disconnect a shared workspace from the people it is shared with.\n\nRestore anyway?';
  }
  const lines = check.workspaces.map((book) =>
    book.inCopy === null
      ? `${book.name} is shared here but not in this copy. Restoring it disconnects ${book.name} from the people it is shared with.`
      : `${book.name} is ${stateWords(book.here)} here but ${stateWords(book.inCopy)} in this copy. Restoring it can disconnect ${book.name} from the people it is shared with.`,
  );
  return `${lines.join('\n\n')}\n\nRestore anyway?`;
}

/** Thrown by a restore the person called off at the sharing warning: nothing was replaced, and nothing is to be said. */
export class RestoreCancelledError extends Error {
  constructor() {
    super('Restore cancelled');
    this.name = 'RestoreCancelledError';
  }
}

type Sqlite3 = Awaited<ReturnType<(typeof import('@sqlite.org/sqlite-wasm'))['default']>>;
let module: Promise<Sqlite3> | null = null;

/**
 * The shared workspaces in a database file's bytes, or null when they cannot be read. A database from before
 * sharing existed (no `shared_books` table) shares nothing.
 */
export async function sharedWorkspacesInBytes(bytes: Uint8Array): Promise<SharedWorkspace[] | null> {
  try {
    module ??= import('@sqlite.org/sqlite-wasm').then((loaded) => loaded.default());
    const sqlite3 = await module;
    const db = new sqlite3.oo1.DB(':memory:');
    try {
      const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(db.pointer!, 'main', pointer, bytes.length, bytes.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE);
      if (rc !== 0) return null;
      const tables = db.selectArrays("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('shared_books', 'books')").map(([name]) => String(name));
      if (!tables.includes('shared_books')) return [];
      if (!tables.includes('books')) return null;
      return db.selectArrays(SHARED_WORKSPACES_SQL).map(([bookId, state, name]) => ({ bookId: String(bookId), state: String(state), name: String(name) }));
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn('Sharing could not be read from a database file', error);
    return null;
  }
}

/**
 * The gate a restore goes through (see `restoreSnapshot`'s `checkSharing`): reads both sides, and when they differ
 * or cannot be compared, asks. Resolves true to go on. `ask` is `window.confirm` in the app: Cancel leaves everything.
 */
export function sharingGate(
  ask: (message: string) => boolean = (message) => window.confirm(message),
  read: (bytes: Uint8Array) => Promise<SharedWorkspace[] | null> = sharedWorkspacesInBytes,
): (sides: { live: Uint8Array | null; chosen: Uint8Array }) => Promise<boolean> {
  return async ({ live, chosen }) => {
    const here = live?.length ? await read(live) : null;
    // Nothing shared here (or nothing here at all, a new phone): there is nothing for the copy to lose.
    if (here && here.every((book) => book.state === 'unshared')) return true;
    const message = restoreSharingMessage(restoreSharingCheck(here, await read(chosen)));
    return message === null || ask(message);
  };
}
