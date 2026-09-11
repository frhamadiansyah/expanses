import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type Method = 'run' | 'all' | 'values' | 'get';
type Request =
  | { id: number; op: 'query'; sql: string; params: unknown[]; method: Method }
  | { id: number; op: 'script'; sql: string }
  | { id: number; op: 'export' }
  | { id: number; op: 'import'; bytes: Uint8Array };

const FILE = '/expanses.sqlite3';

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'expanses' });
  const open = () => {
    const db = new pool.OpfsSAHPoolDb(FILE);
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  };
  return { pool, open, db: open() };
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
    } else if (req.op === 'import') {
      state.db.close();
      try {
        await state.pool.importDb(FILE, req.bytes);
      } finally {
        state.db = state.open();
      }
      reply({ id: req.id, result: null });
    }
  } catch (error) {
    reply({ id: req.id, error: error instanceof Error ? error.message : String(error) });
  }
};
