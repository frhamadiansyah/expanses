import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { SELF_TABLES, settingsKeyClass } from './tables';

/**
 * Every row the owner's other devices hold too (link my devices §2.1): each table that is not `device`, in primary-key
 * order, the `settings` rows of this install left out. Two linked devices in step answer the same thing; the tests
 * compare it.
 */
export async function dumpForSelf(database: Database): Promise<Record<string, unknown[][]>> {
  const out: Record<string, unknown[][]> = {};
  const present = new Set((await database.db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)).map(([name]) => name));
  for (const [table, kind] of Object.entries(SELF_TABLES).sort(([a], [b]) => a.localeCompare(b))) {
    if (kind === 'device' || !present.has(table)) continue;
    const keys = (await database.db.values<[string, number]>(sql`SELECT name, pk FROM pragma_table_info(${table}) WHERE pk > 0 ORDER BY pk`)).map(([name]) => name);
    const order = keys.map((key) => `"${key}"`).join(', ');
    let rows = await database.db.values<unknown[]>(sql.raw(`SELECT * FROM "${table}" ORDER BY ${order}`));
    if (table === 'settings') rows = rows.filter((row) => settingsKeyClass(String(row[0])) !== 'device');
    out[table] = rows;
  }
  return out;
}
