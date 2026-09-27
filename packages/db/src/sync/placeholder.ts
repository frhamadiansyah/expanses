import { and, eq, or, sql, type SQLWrapper } from 'drizzle-orm';
import type { Database, Db } from '../database';
import { sharedBooks } from '../schema-sharing';

/*
 * Household sharing spec §4.4: a placeholder is one `accounts` row per other member, per book and per currency, that
 * a device posts the money side of another member's purchase against. It must never read as the user's own money.
 *
 * `notPlaceholder(column)` is the one shared predicate every reader that lists asset accounts applies (§4.4, checked
 * §3 of docs/superpowers/specs/2026-09-27-household-sharing-v3-check.md): `listAccounts` (accounts.ts), `assetValuesAt`
 * (asset-values.ts), and `coretaxInputsFor`'s own account read (tax-inputs.ts).
 */

/**
 * Whether migration 0056 has run on this database. Every reader that applies `notPlaceholder` asks first, the same
 * way `billTablesExist` and `healthTablesExist` guard their own migrations: a database stopped one version behind
 * today's newest update (`openSafely`'s "one version behind" case) has no `book_member_accounts` table yet, and a
 * predicate that names a table which does not exist fails the whole query rather than reading as "nothing to hide".
 * A positive answer is remembered per handle; a negative one is not, since `migrate()` may run later on the same
 * handle.
 */
const sharingTables = new WeakMap<Db, boolean>();

export async function sharingTablesExist(db: Db): Promise<boolean> {
  if (sharingTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'book_member_accounts'`);
  const exists = rows.length > 0;
  if (exists) sharingTables.set(db, true);
  return exists;
}

/** True when `column` (an `accounts.id`) is not a hidden placeholder account (spec §4.4). */
export function notPlaceholder(column: SQLWrapper) {
  return sql`${column} NOT IN (SELECT account_id FROM book_member_accounts)`;
}

/**
 * Whether `bookId` is a shared book on this device right now: a `shared_books` row exists in state `'active'` or
 * `'needs_invite'` (spec §4.2). `'unshared'` (left the book) does not count. Drives the add form's disabled currency
 * flag and hidden With row (§4.4 last line): in a shared book, the currency is fixed to the book's and every
 * purchase's payer is a member, not a free-text "With".
 *
 * `false` on a database one version behind, where migration 0056 has not run: nothing is shared yet.
 */
export async function isBookShared(database: Database, bookId: string): Promise<boolean> {
  if (!(await sharingTablesExist(database.db))) return false;
  const [row] = await database.db
    .select({ bookId: sharedBooks.bookId })
    .from(sharedBooks)
    .where(and(eq(sharedBooks.bookId, bookId), or(eq(sharedBooks.state, 'active'), eq(sharedBooks.state, 'needs_invite'))));
  return !!row;
}
