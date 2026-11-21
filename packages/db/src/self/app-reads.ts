import { sql } from 'drizzle-orm';
import type { Database } from '../database';

/*
 * Link my devices: the few reads and writes the app's screens need, kept here so the app writes no SQL of its own.
 */

/** What this device holds now, for the new device's warning before a link replaces it. */
export async function heldHere(database: Database): Promise<{ workspaces: number; transactions: number; shared: string[]; empty: boolean }> {
  const count = async (query: ReturnType<typeof sql>) => Number((await database.db.values<[number]>(query))[0]![0]);
  const workspaces = await count(sql`SELECT count(*) FROM books WHERE archived_at IS NULL`);
  const transactions = await count(sql`SELECT count(*) FROM transactions WHERE status = 'posted'`);
  // Nothing of the owner's here: no transaction of any kind, no account or card, one workspace at most — a fresh install,
  // the only data a link may replace without a backup file first.
  const empty =
    (await count(sql`SELECT count(*) FROM transactions`)) === 0 &&
    (await count(sql`SELECT count(*) FROM accounts WHERE kind IN ('asset', 'liability')`)) === 0 &&
    (await count(sql`SELECT count(*) FROM books`)) <= 1;
  let shared: string[] = [];
  try {
    shared = (
      await database.db.values<[string]>(sql`
        SELECT COALESCE(b.name, 'a workspace') FROM shared_books s LEFT JOIN books b ON b.id = s.book_id
        WHERE s.state = 'active' ORDER BY b.name`)
    ).map(([name]) => name);
  } catch {
    // a database from before household sharing shares nothing
  }
  return { workspaces, transactions, shared, empty };
}

/** The synced choices (`settings` under `pref.`), by their localStorage key. */
export async function syncedPrefRows(database: Database): Promise<Map<string, string>> {
  const rows = await database.db.values<[string, string]>(sql`SELECT key, value FROM settings WHERE key LIKE 'pref.%'`);
  return new Map(rows.map(([key, value]) => [key.slice('pref.'.length), value]));
}

/** One synced choice into `settings` (`null` takes it out); `onlyIfAbsent` leaves one already there. */
export async function putSyncedPref(database: Database, key: string, value: string | null, onlyIfAbsent = false): Promise<void> {
  const name = `pref.${key}`;
  if (value === null) await database.db.run(sql`DELETE FROM settings WHERE key = ${name}`);
  else if (onlyIfAbsent) await database.db.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${name}, ${value})`);
  else await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${name}, ${value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}
