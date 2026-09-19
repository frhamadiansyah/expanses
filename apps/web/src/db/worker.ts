import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { NEWER_DATABASE } from './newer-database';

type Method = 'run' | 'all' | 'values' | 'get';
type Request =
  | { id: number; op: 'query'; sql: string; params: unknown[]; method: Method }
  | { id: number; op: 'script'; sql: string }
  | { id: number; op: 'export' }
  | { id: number; op: 'snapshot' }
  /**
   * `latestVersion` is the highest migration the *asking* build knows. It rides in on the request because
   * `LATEST_VERSION` lives in `@expanses/db`, which this worker deliberately does not bundle. A caller
   * that leaves it out gets no version check — never a silent adoption of a newer file, because every
   * caller in the app passes it.
   */
  | { id: number; op: 'import'; bytes: Uint8Array; latestVersion?: number }
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
       * to force it off), so the file is complete and self-consistent whenever no transaction is open.
       *
       * Note what does *not* protect this: `snapshotBytes` goes straight to the worker and never through
       * `createDatabase`'s mutex, so a copy can be asked for in the middle of a transaction another caller
       * has open. What makes the guard sufficient is that `exportFile` is synchronous — once autocommit has
       * answered 1, nothing can start a transaction before the bytes are read, because the worker is single
       * threaded and yields to nobody in between. The check is therefore the whole guard, not a belt on a
       * mutex: 0 means a transaction is in flight and the bytes would be a torn read.
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
        /*
         * And ask SQLite what it makes of the pages, not just of the schema. The rollback window is
         * already open and still holds `previous`, so this is the one moment where "these bytes do not
         * check out" costs the user nothing: it throws into the catch below and the database they had is
         * put straight back. Without it the only question asked of a restored file is whether one table
         * name exists in it, and a file whose b-trees are broken replaces a file that was merely old.
         */
        const structure = state.db.selectValue('PRAGMA quick_check(1)');
        if (structure !== 'ok') throw new Error(`That copy did not check out: ${String(structure)}`);
        /*
         * And last, the one question that cannot be asked after adopting: was this written by a build that
         * knows more than we do? An older app on a newer schema writes rows the new columns do not
         * describe and drops the ones it has never heard of — the file survives and the ledger does not.
         * Asked here, inside the rollback window, it costs the user nothing: the throw lands in the catch
         * below and the database they already had goes straight back.
         */
        if (req.latestVersion !== undefined) {
          const highest = Number(state.db.selectValue('SELECT max(version) FROM schema_migrations') ?? 0);
          if (highest > req.latestVersion) throw new Error(`${NEWER_DATABASE}${highest}`);
        }
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
