import { sql } from 'drizzle-orm';
import ledger from '../migrations/0001_ledger.sql?raw';
import fx from '../migrations/0002_fx.sql?raw';
import points from '../migrations/0003_points.sql?raw';
import incrementRounding from '../migrations/0004_increment_rounding.sql?raw';
import catalog from '../migrations/0005_catalog.sql?raw';
import mccPoints from '../migrations/0006_mcc_points.sql?raw';
import assets from '../migrations/0007_assets.sql?raw';
import type { Database } from './database';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'ledger', sql: ledger },
  { version: 2, name: 'fx', sql: fx },
  { version: 3, name: 'points', sql: points },
  { version: 4, name: 'increment_rounding', sql: incrementRounding },
  { version: 5, name: 'catalog', sql: catalog },
  { version: 6, name: 'mcc_points', sql: mccPoints },
  { version: 7, name: 'assets', sql: assets },
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
