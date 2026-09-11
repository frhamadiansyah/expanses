import { sql } from 'drizzle-orm';
import ledger from '../migrations/0001_ledger.sql?raw';
import fx from '../migrations/0002_fx.sql?raw';
import type { Database } from './database';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'ledger', sql: ledger },
  { version: 2, name: 'fx', sql: fx },
];

/** Applies pending migrations in order, each atomically. Returns applied versions. */
export async function migrate(database: Database, migrations: Migration[] = MIGRATIONS): Promise<number[]> {
  await database.execScript(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const rows = await database.db.values<[number]>(sql`SELECT version FROM schema_migrations`);
  const done = new Set(rows.map((r) => Number(r[0])));
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    const script = `BEGIN IMMEDIATE;\n${m.sql}\nINSERT INTO schema_migrations (version, name, applied_at) VALUES (${m.version}, '${m.name}', '${new Date().toISOString()}');\nCOMMIT;`;
    try {
      await database.execScript(script);
    } catch (error) {
      await database.execScript('ROLLBACK').catch(() => undefined);
      throw error;
    }
    applied.push(m.version);
  }
  return applied;
}
