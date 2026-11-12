import { sql } from 'drizzle-orm';
import type { Database } from '../database';

/*
 * The one list of what is shared with a household (choose-what-to-share, 2026-11-12): it is offered once as the last step
 * of setting up sharing, for each member who joins. Which members it was already offered for — answered or put off with
 * Later — is kept here, per workspace book, in the local `settings` table: never synced, and not browser storage, so a
 * cleared web view does not ask again.
 */

const ASKED_KEY = (bookId: string) => `share.list.asked.${bookId}`;

/** The members of `bookId` the list was already offered for on this phone. */
export async function shareListAskedFor(database: Database, bookId: string): Promise<string[]> {
  const [row] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${ASKED_KEY(bookId)}`);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row[0]) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return []; // an unreadable mark asks again, which is harmless
  }
}

/** Records that the list was offered for these members of `bookId` (added to those already recorded). */
export async function markShareListAsked(database: Database, bookId: string, memberIds: readonly string[]): Promise<void> {
  const before = await shareListAskedFor(database, bookId);
  const after = [...new Set([...before, ...memberIds])].sort();
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${ASKED_KEY(bookId)}, ${JSON.stringify(after)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}
