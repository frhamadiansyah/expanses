import BetterSqlite3 from 'better-sqlite3';
import type { SqlExecutor } from './executor';

export interface NodeExecutor extends SqlExecutor {
  close(): void;
}

function open(connection: BetterSqlite3.Database): BetterSqlite3.Database {
  connection.pragma('foreign_keys = ON');
  return connection;
}

/** In-memory SQLite for tests, speaking the same executor protocol as the browser worker. */
export function createNodeExecutor(): NodeExecutor {
  let sqlite = open(new BetterSqlite3(':memory:'));
  return {
    async query(sql, params, method) {
      const stmt = sqlite.prepare(sql);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const args = params as any[];
      if (method === 'run' || !stmt.reader) {
        stmt.run(...args);
        return method === 'get' ? undefined : [];
      }
      if (method === 'get') return stmt.raw(true).get(...args);
      return stmt.raw(true).all(...args);
    },
    async execScript(sql) {
      sqlite.exec(sql);
    },
    async exportBytes() {
      return new Uint8Array(sqlite.serialize());
    },
    async importBytes(bytes) {
      const next = open(new BetterSqlite3(Buffer.from(bytes)));
      sqlite.close();
      sqlite = next;
    },
    close() {
      sqlite.close();
    },
  };
}
