/*
 * A small record of what went wrong with sharing on this device: `expanses-safety/sync-log.json`, beside the
 * recovery screen's `last-failure.json` (src/db/failure-log.ts) and for the same reason — a phone in a TestFlight
 * build has no console anyone can read, and a background sync's failure used to go nowhere else.
 *
 * - Local only. The safety folder is outside the database, so nothing here is synced to the relay or reaches anyone
 *   in a shared workspace, and it outlives a database that was lost and restored.
 * - Ids, op names and error text only: never an amount, a description, a name or a key. An error's message is
 *   trimmed of what a failed query appends (`params: …`, the row's values) and of anything long enough to be a key.
 * - The newest 50 entries, newest first. Recording never throws: a log that cannot be written stays in memory.
 */

/** How many entries are kept. */
export const SYNC_LOG_KEEP = 50;
export const SYNC_LOG_FILE = 'sync-log.json';

/** What was being done when it happened. */
export type SyncLogOp =
  | 'sync'
  | 'group'
  | 'apply'
  | 'pull'
  | 'prepare'
  | 'restore'
  | 'refresh'
  | 'seen'
  | 'seed'
  | 'drain'
  | 'invite'
  | 'share'
  | 'preview'
  | 'join'
  | 'remove'
  | 'leave'
  | 'stop'
  | 'act';

export interface SyncLogEntry {
  /** ISO time. */
  at: string;
  /** `error` for a failure; `info` for something worth knowing that did not fail (a share sent, a restore check). */
  level: 'error' | 'info';
  op: SyncLogOp;
  /** The local book id, whole: what the log is read by. Null for a device-wide failure (the keys, a preview). */
  bookId: string | null;
  /** The relay's book id, its first eight characters. */
  relayBookId: string | null;
  /** The error's name (`SyncTransportError`), or `Info`. */
  name: string;
  message: string;
  /** `SharingError.code`, or a DOMException's name when it differs. */
  code: string | null;
  /** `SyncTransportError.status`. */
  status: number | null;
  /** The stack's first frame: function and file:line:col, no host. */
  frame: string | null;
  /** The engine's `bookSyncStatus` right after, in short: `waiting 3`, `needs_invite`, `none`. */
  state: string | null;
}

/** The fields every entry has, and no others: what the shape test holds the log to. */
export const SYNC_LOG_FIELDS = ['at', 'level', 'op', 'bookId', 'relayBookId', 'name', 'message', 'code', 'status', 'frame', 'state'] as const;

export interface SyncLogInput {
  op: SyncLogOp;
  bookId?: string | null;
  relayBookId?: string | null;
  /** A failure; or leave it out and give `message` for an info entry. */
  error?: unknown;
  message?: string;
  state?: string | null;
}

/** The first eight characters of an id, or null. */
export const shortId = (id: string | null | undefined): string | null => (id ? id.slice(0, 8) : null);

const MAX_MESSAGE = 300;

/** An error's words, with nothing a query or a key could carry. */
export function cleanMessage(text: string): string {
  return (
    text
      // A failed query (drizzle's DrizzleQueryError) appends the row's own values: amounts, descriptions, names.
      .replace(/\s*params:[\s\S]*$/i, '')
      // A key, a token or an invite code: anything this long in one run of base64url characters.
      .replace(/[A-Za-z0-9_\-=]{40,}/g, '[…]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_MESSAGE)
  );
}

/** The first frame of a stack, as `fn@file.js:1:2` with no scheme or host. */
export function firstFrame(stack: string | undefined, message: string): string | null {
  if (!stack) return null;
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    // The message's own lines (Chrome puts the message first, and a failed query's runs over several lines).
    if (!line || (message && (message.includes(line) || line.includes(message.split('\n')[0]!))) || /^[A-Za-z]*Error\b/.test(line)) continue;
    const cleaned = line
      .replace(/^at\s+/, '')
      .replace(/[a-z-]+:\/\/[^/\s)]*\//gi, '')
      .replace(/\?[^:\s)]*/g, '');
    return cleanMessage(cleaned).slice(0, 160);
  }
  return null;
}

/** An error, any error, as the log keeps it. */
export function describeError(error: unknown): Pick<SyncLogEntry, 'name' | 'message' | 'code' | 'status' | 'frame'> {
  if (error instanceof Error) {
    const withExtras = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
    let message = cleanMessage(error.message);
    // A failed query's own message is the SQL; what SQLite said is the cause.
    if (withExtras.cause instanceof Error && withExtras.cause.message && !message.includes(withExtras.cause.message)) {
      message = cleanMessage(`${message} — cause: ${withExtras.cause.name}: ${withExtras.cause.message}`);
    }
    const code = typeof withExtras.code === 'string' || typeof withExtras.code === 'number' ? String(withExtras.code) : null;
    return {
      name: error.name || 'Error',
      message: message || '(no message)',
      code,
      status: typeof withExtras.status === 'number' ? withExtras.status : null,
      frame: firstFrame(error.stack, error.message),
    };
  }
  const text = typeof error === 'string' ? error : (() => {
    try {
      return JSON.stringify(error) ?? String(error);
    } catch {
      return String(error);
    }
  })();
  return { name: typeof error, message: cleanMessage(text) || '(no message)', code: null, status: null, frame: null };
}

const isEntry = (value: unknown): value is SyncLogEntry => {
  const e = value as Partial<SyncLogEntry> | null;
  return !!e && typeof e.at === 'string' && typeof e.op === 'string' && typeof e.message === 'string' && typeof e.name === 'string';
};

export function parseSyncLog(raw: Uint8Array | null): SyncLogEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export interface SyncLogStore {
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
}

/** A store over one variable: the tests', and the default where no device store is given. */
export function memorySyncLogStore(initial: Uint8Array | null = null): SyncLogStore & { bytes: Uint8Array | null } {
  const store = {
    bytes: initial,
    read: async () => store.bytes,
    write: async (bytes: Uint8Array) => {
      store.bytes = bytes;
    },
  };
  return store;
}

export class SyncLog {
  private loaded: Promise<SyncLogEntry[]> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: SyncLogStore = memorySyncLogStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly keep = SYNC_LOG_KEEP,
  ) {}

  /** Adds an entry, newest first, and writes the log. Never throws; resolves once written (or given up on). */
  record(input: SyncLogInput): Promise<void> {
    const failure = input.error !== undefined;
    const entry: SyncLogEntry = {
      at: this.now().toISOString(),
      level: failure ? 'error' : 'info',
      op: input.op,
      bookId: input.bookId ?? null,
      relayBookId: shortId(input.relayBookId),
      ...(failure ? describeError(input.error) : { name: 'Info', message: cleanMessage(input.message ?? ''), code: null, status: null, frame: null }),
      state: input.state ?? null,
    };
    const run = this.chain.then(async () => {
      const log = [entry, ...(await this.entries())].slice(0, this.keep);
      this.loaded = Promise.resolve(log);
      try {
        await this.store.write(new TextEncoder().encode(JSON.stringify(log)));
      } catch {
        // Kept in memory for this session; the next entry tries the file again.
      }
      for (const listener of this.listeners) listener();
    });
    this.chain = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  /** Every entry, newest first. */
  entries(): Promise<SyncLogEntry[]> {
    this.loaded ??= this.store.read().then(parseSyncLog, () => []);
    return this.loaded;
  }

  /** One book's entries and the device-wide ones (no book), newest first. */
  async forBook(bookId: string): Promise<SyncLogEntry[]> {
    return (await this.entries()).filter((entry) => entry.bookId === bookId || entry.bookId === null);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** One entry on one line, for "Copy details". */
export function formatSyncLogEntry(entry: SyncLogEntry): string {
  const where = [entry.bookId ? `book ${shortId(entry.bookId)}` : 'device', entry.relayBookId ? `relay ${entry.relayBookId}` : null].filter(Boolean).join(' ');
  const what = entry.level === 'info' ? entry.message : `${entry.name}${entry.code ? ` ${entry.code}` : ''}${entry.status !== null ? ` ${entry.status}` : ''}: ${entry.message}`;
  return [`${entry.at} ${entry.op} (${where})`, what, entry.frame ? `at ${entry.frame}` : null, entry.state ? `state ${entry.state}` : null].filter(Boolean).join(' · ');
}
