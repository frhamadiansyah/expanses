import { describe, expect, it } from 'vitest';
import { deterministicRefusal } from '../../src/sync/apply';

/*
 * Which SQLite errors apply skips as a refusal every receiver makes alike (§7.1, task 4 fix round 2): CHECK and NOT
 * NULL, never UNIQUE or FOREIGN KEY. On a phone the error is sqlite-wasm's (`SQLite3Error`: a `resultCode`, no `code`,
 * a message that starts with the code's name); a worker from before the sync refusal fix passed its message alone.
 */

/** What reaches apply on a phone: Drizzle's wrapper, and under it the worker's rebuilt error. */
function onPhone(message: string, carried?: { code: string; resultCode: number }): Error {
  const sqlite = new Error(message);
  if (carried) Object.assign(sqlite, carried, { name: 'SQLite3Error' });
  return new Error('Failed query: INSERT INTO t (a) VALUES (?)\nparams: x', { cause: sqlite });
}

const WASM = {
  check: 'SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK constraint failed: n > 0',
  notNull: 'SQLITE_CONSTRAINT_NOTNULL: sqlite3 result code 1299: NOT NULL constraint failed: t.n',
  unique: 'SQLITE_CONSTRAINT_UNIQUE: sqlite3 result code 2067: UNIQUE constraint failed: t.key',
  primaryKey: 'SQLITE_CONSTRAINT_PRIMARYKEY: sqlite3 result code 1555: UNIQUE constraint failed: t.id',
  foreignKey: 'SQLITE_CONSTRAINT_FOREIGNKEY: sqlite3 result code 787: FOREIGN KEY constraint failed',
};

describe('a phone SQLite error with no code', () => {
  it('a CHECK or NOT NULL is a refusal, read from its message, and recorded without the prefix repeated', () => {
    expect(deterministicRefusal(onPhone(WASM.check))).toEqual({ name: 'Error', code: 'SQLITE_CONSTRAINT_CHECK', message: 'CHECK constraint failed: n > 0' });
    expect(deterministicRefusal(onPhone(WASM.notNull))).toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL', message: 'NOT NULL constraint failed: t.n' });
    // SQLite's sentence on its own, as another SQLite build words it.
    expect(deterministicRefusal(onPhone('CHECK constraint failed: n > 0'))).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    expect(deterministicRefusal(onPhone('NOT NULL constraint failed: t.n'))).toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL' });
  });

  it('a UNIQUE, PRIMARY KEY or FOREIGN KEY still stops the loop', () => {
    expect(deterministicRefusal(onPhone(WASM.unique))).toBeNull();
    expect(deterministicRefusal(onPhone(WASM.primaryKey))).toBeNull();
    expect(deterministicRefusal(onPhone(WASM.foreignKey))).toBeNull();
    expect(deterministicRefusal(onPhone('UNIQUE constraint failed: t.key'))).toBeNull();
    expect(deterministicRefusal(onPhone('FOREIGN KEY constraint failed'))).toBeNull();
  });

  it('only SQLite\'s own words count, at the start: a wrapper quoting them, or a message that merely mentions them, does not', () => {
    const quoted = new Error('Failed query: UPDATE t SET note = ?\nparams: CHECK constraint failed', { cause: new Error(WASM.unique) });
    expect(deterministicRefusal(quoted)).toBeNull();
    expect(deterministicRefusal(new Error('Failed query: x', { cause: new Error('the CHECK constraint failed: n > 0') }))).toBeNull();
    expect(deterministicRefusal(new Error('Failed query: x', { cause: new Error('SQLITE_CONSTRAINT_CHECK happened') }))).toBeNull();
  });
});

describe('a phone SQLite error with its code carried', () => {
  it('reads the code, and a code always wins over the message', () => {
    expect(deterministicRefusal(onPhone(WASM.check, { code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275 }))).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK', name: 'SQLite3Error', message: 'CHECK constraint failed: n > 0' });
    expect(deterministicRefusal(onPhone(WASM.unique, { code: 'SQLITE_CONSTRAINT_UNIQUE', resultCode: 2067 }))).toBeNull();
    expect(deterministicRefusal(onPhone(WASM.foreignKey, { code: 'SQLITE_CONSTRAINT_FOREIGNKEY', resultCode: 787 }))).toBeNull();
    // A code that says UNIQUE is believed over words that say CHECK.
    expect(deterministicRefusal(onPhone(WASM.check, { code: 'SQLITE_CONSTRAINT_UNIQUE', resultCode: 2067 }))).toBeNull();
  });
});

describe("a computer's SQLite error (better-sqlite3: a code, SQLite's sentence)", () => {
  it('is read as before', () => {
    const node = (code: string, message: string) => new Error('Failed query: x', { cause: Object.assign(new Error(message), { code, name: 'SqliteError' }) });
    expect(deterministicRefusal(node('SQLITE_CONSTRAINT_CHECK', 'CHECK constraint failed: n > 0'))).toEqual({ name: 'SqliteError', code: 'SQLITE_CONSTRAINT_CHECK', message: 'CHECK constraint failed: n > 0' });
    expect(deterministicRefusal(node('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed: t.key'))).toBeNull();
    expect(deterministicRefusal(node('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed'))).toBeNull();
  });
});
