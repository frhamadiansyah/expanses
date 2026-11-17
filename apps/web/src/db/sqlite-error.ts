/**
 * What crosses the worker boundary beside an error's message, so the main thread gets SQLite's answer and not only its
 * words.
 *
 * sqlite-wasm throws a `SQLite3Error`: `name` 'SQLite3Error', `resultCode` the extended result code (275 for a CHECK), and
 * no `code` at all; its message starts with the code's name ("SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK
 * constraint failed: n > 0"). A worker reply is a structured clone, and until the sync refusal fix (2026-11-17) it held the
 * message alone, rebuilt on the main thread as a plain `Error`. So the one thing sync apply reads to tell a refusal every
 * phone makes alike (CHECK, NOT NULL: skip it) from one that depends on this phone's rows (UNIQUE, FOREIGN KEY: stop) never
 * arrived, and a phone's pull stopped at a CHECK for good. `code` here is the same string better-sqlite3 gives on a
 * computer ('SQLITE_CONSTRAINT_CHECK'), which is what apply compares.
 *
 * Dependency-free, like `fatal.ts`: the worker imports it and must not pull in `@expanses/db`. The message is never
 * touched — `fatal.ts` reads it on both sides of the boundary, and it must read the same words it always has.
 */
export interface SqliteErrorFields {
  /** The extended result code's name, e.g. 'SQLITE_CONSTRAINT_CHECK'. */
  code?: string;
  /** The extended result code, e.g. 275. */
  resultCode?: number;
  /** The error's own name, e.g. 'SQLite3Error'. */
  name?: string;
}

/** sqlite-wasm's own prefix on every message it builds from a result code. */
const PREFIX = /^(SQLITE_[A-Z_]+): sqlite3 result code (\d+):/;

/**
 * The fields worth carrying from an error the worker caught. `rcName` is sqlite-wasm's `capi.sqlite3_js_rc_str` once the
 * module has loaded; without it, or for a code it does not name, the code is read from the message's own prefix, the
 * same string sqlite-wasm built it from. An error that is not SQLite's carries nothing, its name included: the main thread
 * goes on seeing a plain `Error` for everything else, as it always has.
 */
export function sqliteErrorFields(error: unknown, rcName?: (rc: number) => string | undefined): SqliteErrorFields {
  if (!error || typeof error !== 'object') return {};
  const raw = error as { code?: unknown; resultCode?: unknown; name?: unknown; message?: unknown };
  const prefixed = typeof raw.message === 'string' ? PREFIX.exec(raw.message) : null;
  const resultCode = Number.isInteger(raw.resultCode) ? (raw.resultCode as number) : prefixed ? Number(prefixed[2]) : undefined;
  const named = (value: unknown): value is string => typeof value === 'string' && value.startsWith('SQLITE_');
  let code: string | undefined = named(raw.code) ? raw.code : undefined;
  if (code === undefined && resultCode !== undefined) {
    let fromModule: unknown;
    try {
      fromModule = rcName?.(resultCode);
    } catch {
      fromModule = undefined;
    }
    code = named(fromModule) ? fromModule : prefixed?.[1];
  }
  if (resultCode === undefined && code === undefined) return {};
  const fields: SqliteErrorFields = {};
  if (code !== undefined) fields.code = code;
  if (resultCode !== undefined) fields.resultCode = resultCode;
  if (typeof raw.name === 'string') fields.name = raw.name;
  return fields;
}

/** The main thread's copy of a worker's error: its message as it was, and whatever SQLite fields came with it. */
export function rebuildError(message: string, fields: SqliteErrorFields): Error {
  const error = new Error(message) as Error & SqliteErrorFields;
  if (typeof fields.code === 'string') error.code = fields.code;
  if (typeof fields.resultCode === 'number') error.resultCode = fields.resultCode;
  if (typeof fields.name === 'string') error.name = fields.name;
  return error;
}
