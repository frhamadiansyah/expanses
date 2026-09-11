import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import type { SqlExecutor } from './executor';

export type Db = SqliteRemoteDatabase;

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
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  execScript(sql: string): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<void>;
}

export function createDatabase(executor: SqlExecutor): Database {
  const mutex = new Mutex();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const direct = drizzle(async (sql, params, method) => ({ rows: (await executor.query(sql, params, method)) as any[] }));
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
          await executor.execScript('ROLLBACK');
          throw error;
        }
      }),
    execScript: (sql) => mutex.run(() => executor.execScript(sql)),
    exportBytes: () => mutex.run(() => executor.exportBytes()),
    importBytes: (bytes) => mutex.run(() => executor.importBytes(bytes)),
  };
}
