import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createDatabase } from '@expanses/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RecoveryReason } from './open';
import { rebuildError, sqliteErrorFields } from './sqlite-error';
import { createWorkerExecutor } from './worker-executor';

/*
 * The sync refusal fix (2026-11-17): a phone's SQLite errors cross the worker boundary with their code, so sync apply
 * can tell a CHECK (every phone refuses it alike: skip) from a UNIQUE (this phone's rows: stop). Run on sqlite-wasm
 * itself — its node build is the same engine the phone runs, minus the OPFS file — so the shape is the library's, not
 * a guess at it.
 */

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
let sqlite3: Sqlite3;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

/** A fresh in-memory database with one table whose every constraint can be broken. */
function openDb() {
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL CHECK (n > 0), k TEXT UNIQUE, p TEXT REFERENCES p (id))');
  db.exec("INSERT INTO t VALUES ('a', 1, 'k', NULL)");
  return db;
}

/** What sqlite-wasm throws for a statement. */
function thrownBy(db: ReturnType<typeof openDb>, text: string, bind: unknown[]): unknown {
  try {
    db.exec({ sql: text, bind: bind as never });
  } catch (error) {
    return error;
  }
  throw new Error('no error');
}

const INSERT = 'INSERT INTO t VALUES (?, ?, ?, ?)';
const BROKEN = {
  check: ['b', -1, null, null],
  notNull: ['c', null, null, null],
  unique: ['d', 2, 'k', null],
  primaryKey: ['a', 2, null, null],
  foreignKey: ['e', 2, null, 'nope'],
} as const;

/**
 * Enough of `worker.ts` to answer `query` and `script` from a real sqlite-wasm database: the same `exec` calls, and the
 * same error reply, built by the same helper.
 */
function wasmWorker(db: ReturnType<typeof openDb>) {
  const rcName = (rc: number) => sqlite3.capi.sqlite3_js_rc_str(rc);
  const worker = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    postMessage(req: { id: number; op: string; sql: string; params?: unknown[]; method?: string }) {
      let data: Record<string, unknown>;
      try {
        if (req.op === 'script') {
          db.exec(req.sql);
          data = { id: req.id, result: null };
        } else if (req.method === 'run') {
          db.exec({ sql: req.sql, bind: req.params?.length ? (req.params as never) : undefined });
          data = { id: req.id, result: [] };
        } else {
          const rows = db.exec({ sql: req.sql, bind: req.params?.length ? (req.params as never) : undefined, rowMode: 'array', returnValue: 'resultRows' }) as unknown[];
          data = { id: req.id, result: req.method === 'get' ? rows[0] : rows };
        }
      } catch (error) {
        data = { id: req.id, error: error instanceof Error ? error.message : String(error), ...sqliteErrorFields(error, rcName) };
      }
      // A structured clone, as `postMessage` makes: nothing but plain data crosses.
      const cloned = structuredClone(data);
      queueMicrotask(() => worker.onmessage?.({ data: cloned } as MessageEvent<unknown>));
    },
    terminate() {},
  };
  return worker;
}

describe("sqlite-wasm's own error", () => {
  it('is a SQLite3Error with an extended resultCode, no code, and a message that starts with the code name', () => {
    const db = openDb();
    const error = thrownBy(db, INSERT, [...BROKEN.check]) as Error & { resultCode?: number; code?: unknown };
    expect(error.name).toBe('SQLite3Error');
    expect(error.resultCode).toBe(275);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK constraint failed: n > 0');
    expect((thrownBy(db, INSERT, [...BROKEN.notNull]) as Error).message).toBe('SQLITE_CONSTRAINT_NOTNULL: sqlite3 result code 1299: NOT NULL constraint failed: t.n');
  });
});

describe('what the worker carries beside the message', () => {
  it("names each constraint as a computer's SQLite does, with its extended result code", () => {
    const db = openDb();
    const rcName = (rc: number) => sqlite3.capi.sqlite3_js_rc_str(rc);
    const carried = Object.fromEntries(Object.entries(BROKEN).map(([kind, bind]) => [kind, sqliteErrorFields(thrownBy(db, INSERT, [...bind]), rcName)]));
    expect(carried).toEqual({
      check: { code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275, name: 'SQLite3Error' },
      notNull: { code: 'SQLITE_CONSTRAINT_NOTNULL', resultCode: 1299, name: 'SQLite3Error' },
      unique: { code: 'SQLITE_CONSTRAINT_UNIQUE', resultCode: 2067, name: 'SQLite3Error' },
      primaryKey: { code: 'SQLITE_CONSTRAINT_PRIMARYKEY', resultCode: 1555, name: 'SQLite3Error' },
      foreignKey: { code: 'SQLITE_CONSTRAINT_FOREIGNKEY', resultCode: 787, name: 'SQLite3Error' },
    });
  });

  it('reads the code from the message when the module cannot name it, and carries nothing for an error that is not SQLite’s', () => {
    const db = openDb();
    expect(sqliteErrorFields(thrownBy(db, INSERT, [...BROKEN.check]))).toEqual({ code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275, name: 'SQLite3Error' });
    expect(sqliteErrorFields(new Error('busy'))).toEqual({});
    expect(sqliteErrorFields(new Error('That file is not an Expanses backup.'))).toEqual({});
    expect(sqliteErrorFields(Object.assign(new Error('gone'), { name: 'NotFoundError', code: 8 }))).toEqual({});
    expect(sqliteErrorFields('a string')).toEqual({});
  });

  it('is put back on the main thread with the message untouched', () => {
    const rebuilt = rebuildError('SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK constraint failed: n > 0', { code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275, name: 'SQLite3Error' });
    expect(rebuilt).toBeInstanceOf(Error);
    expect(rebuilt).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275, name: 'SQLite3Error', message: 'SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK constraint failed: n > 0' });
    // Nothing carried: the plain Error it always was.
    const plain = rebuildError('busy', {});
    expect(plain.name).toBe('Error');
    expect('code' in plain).toBe(false);
  });
});

describe('through the worker executor, as a phone runs it', () => {
  it('a refused write rejects with the code, result code and name, under Drizzle as its cause', async () => {
    const db = openDb();
    const executor = createWorkerExecutor(wasmWorker(db) as unknown as Worker);
    const database = createDatabase(executor);
    const failure = (bind: readonly unknown[]) =>
      database.db.run(sql`INSERT INTO t VALUES (${bind[0]}, ${bind[1]}, ${bind[2]}, ${bind[3]})`).then(
        () => null,
        (error: unknown) => error as Error & { cause?: Error & { code?: string; resultCode?: number } },
      );
    const check = await failure(BROKEN.check);
    expect(check?.cause).toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK', resultCode: 275, name: 'SQLite3Error', message: 'SQLITE_CONSTRAINT_CHECK: sqlite3 result code 275: CHECK constraint failed: n > 0' });
    expect((await failure(BROKEN.notNull))?.cause?.code).toBe('SQLITE_CONSTRAINT_NOTNULL');
    expect((await failure(BROKEN.unique))?.cause?.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect((await failure(BROKEN.primaryKey))?.cause?.code).toBe('SQLITE_CONSTRAINT_PRIMARYKEY');
    expect((await failure(BROKEN.foreignKey))?.cause?.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
    // And the database goes on answering: a refused write is not the end of a session.
    expect(await database.db.values(sql`SELECT count(*) FROM t`)).toEqual([[1]]);
  });

  it('a constraint is never a fatal; a damaged page still is, code or no code', async () => {
    const db = openDb();
    const executor = createWorkerExecutor(wasmWorker(db) as unknown as Worker);
    const heard: RecoveryReason[] = [];
    executor.onFatal((reason) => heard.push(reason));
    await expect(executor.query(INSERT, [...BROKEN.check], 'run')).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_CHECK' });
    await expect(executor.query(INSERT, [...BROKEN.unique], 'run')).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_UNIQUE' });
    expect(heard).toEqual([]);

    // A corrupt page as the worker replies with it: the message still decides, the code rides along.
    const corrupt = {
      onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      onerror: null,
      postMessage(req: { id: number }) {
        queueMicrotask(() =>
          corrupt.onmessage?.({ data: { id: req.id, error: 'SQLITE_CORRUPT: sqlite3 result code 11: database disk image is malformed', code: 'SQLITE_CORRUPT', resultCode: 11, name: 'SQLite3Error', fatal: 'corrupt' } } as MessageEvent<unknown>),
        );
      },
      terminate() {},
    };
    const struck = createWorkerExecutor(corrupt as unknown as Worker);
    const told: RecoveryReason[] = [];
    struck.onFatal((reason) => told.push(reason));
    await expect(struck.query('SELECT 1', [], 'all')).rejects.toMatchObject({ code: 'SQLITE_CORRUPT', message: expect.stringMatching(/malformed/) });
    expect(told.map((reason) => reason.kind)).toEqual(['corrupt']);
  });
});
