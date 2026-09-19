import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Method = 'run' | 'all' | 'values' | 'get';
type Request =
  | { id: number; op: 'query'; sql: string; params: unknown[]; method: Method }
  | { id: number; op: 'script'; sql: string }
  | { id: number; op: 'export' }
  | { id: number; op: 'snapshot' }
  | { id: number; op: 'import'; bytes: Uint8Array }
  | { id: number; op: 'wipe' };

const FILE = '/expanses.sqlite3';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'expanses' });
  const open = () => {
    const db = new pool.OpfsSAHPoolDb(FILE);
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  };
  // `sqlite3` is kept so the snapshot op can reach `capi` for the autocommit guard.
  return { sqlite3, pool, open, db: open() };
})();

const reply = (message: unknown, transfer: Transferable[] = []) => postMessage(message, { transfer });

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    const state = await ready;
    if (req.op === 'query') {
      const bind = req.params.length ? (req.params as never) : undefined;
      if (req.method === 'run') {
        state.db.exec({ sql: req.sql, bind });
        reply({ id: req.id, result: [] });
      } else {
        const rows = state.db.exec({ sql: req.sql, bind, rowMode: 'array', returnValue: 'resultRows' }) as unknown[];
        reply({ id: req.id, result: req.method === 'get' ? rows[0] : rows });
      }
    } else if (req.op === 'script') {
      state.db.exec(req.sql);
      reply({ id: req.id, result: null });
    } else if (req.op === 'export') {
      const bytes = await state.pool.exportFile(FILE);
      reply({ id: req.id, result: bytes }, [bytes.buffer]);
    } else if (req.op === 'snapshot') {
      /*
       * A file copy, taken between statements. The SAH pool has no WAL (importDb even rewrites the header
       * to force it off), so the file is complete and self-consistent whenever no transaction is open —
       * and the worker handles one request at a time, behind the Database mutex. The autocommit check is
       * the belt: 0 means a transaction is in flight and the bytes would be a torn read.
       */
      if (!state.sqlite3.capi.sqlite3_get_autocommit(state.db)) throw new Error('busy');
      const bytes = await state.pool.exportFile(FILE);
      reply({ id: req.id, result: bytes }, [bytes.buffer]);
    } else if (req.op === 'import') {
      // Keep the current database so a failed or foreign file restores the previous state instead of an empty one.
      const previous = await state.pool.exportFile(FILE);
      state.db.close();
      try {
        await state.pool.importDb(FILE, req.bytes);
        state.db = state.open();
        const hasSchema = state.db.selectValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
        if (!hasSchema) throw new Error('That file is not an Expanses backup.');
      } catch (error) {
        try {
          state.db.close();
        } catch {
          // already closed
        }
        await state.pool.importDb(FILE, previous);
        state.db = state.open();
        throw error;
      }
      reply({ id: req.id, result: null });
    } else if (req.op === 'wipe') {
      // Only ever reached from "Start fresh", after the user has said so twice. Every slot the pool owns
      // goes, not just the database file, so what opens next is a device that has never run Expanses.
      try {
        state.db.close();
      } catch {
        // already closed
      }
      await state.pool.wipeFiles();
      state.db = state.open();
      reply({ id: req.id, result: null });
    }
  } catch (error) {
    reply({ id: req.id, error: error instanceof Error ? error.message : String(error) });
  }
};
