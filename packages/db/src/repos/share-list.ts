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

const SEEDED_KEY = 'share.list.seeded';

/**
 * The first run of the build that brought the list (fix round 1, 5): every member already in a shared workspace from a
 * phone counts as offered, so a household sharing since before is not sent to the set-up step on updating — the list
 * is a row of the Share page for them. Runs once per database; only workspace books (an event's own book has no
 * `books` row).
 */
export async function seedShareListAsked(database: Database): Promise<void> {
  if ((await database.db.values(sql`SELECT 1 FROM settings WHERE key = ${SEEDED_KEY}`)).length > 0) return;
  if ((await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_books'`)).length > 0) {
    const rows = await database.db.values<[string, string]>(sql`
      SELECT DISTINCT s.book_id, d.member_id FROM shared_books s
      JOIN book_devices d ON d.book_id = s.book_id AND d.removed_at IS NULL AND d.member_id <> s.member_id
      WHERE s.book_id IN (SELECT id FROM books)`);
    const byBook = new Map<string, string[]>();
    for (const [bookId, memberId] of rows) byBook.set(bookId, [...(byBook.get(bookId) ?? []), memberId]);
    for (const [bookId, members] of byBook) await markShareListAsked(database, bookId, members);
  }
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${SEEDED_KEY}, '1') ON CONFLICT (key) DO NOTHING`);
}
