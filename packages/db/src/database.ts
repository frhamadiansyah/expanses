import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { SqlExecutor } from './executor';

export type Db = SqliteRemoteDatabase;

/**
 * A `Db` known to be running inside `Database.transaction()` — the whole-database mutex below is held for that
 * call's entire duration, so code given a `Tx` can read then write without any locking of its own: nothing else
 * touching this `Database` runs until the transaction returns. There is no way to produce a `Tx` other than through
 * `transaction()`'s callback (not even `database.db`, despite being the same underlying type) — a function that
 * asks for `Tx` instead of `Db` in its signature is asking, at the type level, "call me from inside a transaction".
 */
export type Tx = Db & { readonly __tx: 'tx' };

class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

export interface Database {
  /** Serialized access. Never use inside transaction(); use its tx argument. */
  db: Db;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  execScript(sql: string): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<void>;
}

export function createDatabase(executor: SqlExecutor): Database {
  const mutex = new Mutex();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = drizzle(async (sql, params, method) => ({ rows: (await executor.query(sql, params, method)) as any[] })) as Tx;
  const locked = drizzle(async (sql, params, method) => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: (await mutex.run(() => executor.query(sql, params, method))) as any[],
  }));

  return {
    db: locked,
    transaction: (fn) =>
      mutex.run(async () => {
        await executor.execScript('BEGIN IMMEDIATE');
        try {
          const result = await fn(direct);
          await executor.execScript('COMMIT');
          return result;
        } catch (error) {
          try {
            await executor.execScript('ROLLBACK');
          } catch {
            // SQLite may have rolled back already; surface the error that caused the failure.
          }
          throw error;
        }
      }),
    execScript: (sql) => mutex.run(() => executor.execScript(sql)),
    exportBytes: () => mutex.run(() => executor.exportBytes()),
    importBytes: (bytes) => mutex.run(() => executor.importBytes(bytes)),
  };
}
