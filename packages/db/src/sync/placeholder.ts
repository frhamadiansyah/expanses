import { and, eq, or, sql, type SQLWrapper } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
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

/** A placeholder account's member: their name as the book holds it, and whether it is this device's own member. */
export interface MemberPayer {
  name: string;
  /**
   * This device's own member in that book: a phone restored or set up anew gets back its member's own bills (and
   * purchases) on a placeholder for itself (`payerAccountTx`: an own account only while the row already is one). Such
   * a bill is still this phone's to pay.
   */
  self: boolean;
}

/**
 * Every placeholder account in the workspace (spec §4.4) and the member it stands for, by that member's name as the book
 * holds it now (a rename reaches it; the placeholder's own name is the one it was made with). A bill another member pays
 * from an account of their own arrives on this phone naming one of these, never their account (`payerAccountTx`), so
 * this is all a partner's phone can know of who pays it — not whether it is a card. Empty on a database one version
 * behind, where nothing is shared yet.
 */
export async function memberPayerAccounts(database: Database, ws: WorkspaceContext): Promise<Map<string, MemberPayer>> {
  if (!(await sharingTablesExist(database.db))) return new Map();
  const rows = await database.db.values<[string, string | null, string, number]>(sql`
    SELECT m.account_id, bm.name, a.name,
      EXISTS (SELECT 1 FROM shared_books sb WHERE sb.book_id = m.book_id AND sb.member_id = m.member_id)
    FROM book_member_accounts m
    JOIN accounts a ON a.id = m.account_id AND a.workspace_id = ${ws.workspaceId}
    LEFT JOIN book_members bm ON bm.book_id = m.book_id AND bm.member_id = m.member_id`);
  return new Map(rows.map(([accountId, member, placeholder, self]) => [accountId, { name: member || placeholder, self: Number(self) === 1 }]));
}

/**
 * Which of `lines` are on household placeholders (spec §4.4), and — on a transfer between partners (joint net worth
 * §7.2) — the kind of the partner's shared item each such line stands for: the transfer's side owned by the member the
 * placeholder is for (never this phone's own side), read from that item's summary in the group log. What a row is named
 * by (`transferSideOf`): the placeholder's own 'cash' says nothing. A side kept private, an item no longer shared, or a
 * database from before the group log knows no kind. Three queries at most, however many rows. Empty on a database one
 * version behind, where nothing is shared yet.
 */
export async function placeholderLinesOf(
  db: Db,
  lines: readonly { transactionId: string; accountId: string }[],
): Promise<{ placeholders: Set<string>; partnerSubtype: (transactionId: string, accountId: string) => string | null }> {
  const none = { placeholders: new Set<string>(), partnerSubtype: () => null };
  if (lines.length === 0 || !(await sharingTablesExist(db))) return none;
  const memberOf = new Map(
    await db.values<[string, string]>(sql`SELECT account_id, member_id FROM book_member_accounts WHERE account_id IN ${[...new Set(lines.map((line) => line.accountId))]}`),
  );
  if (memberOf.size === 0) return none;
  // transaction id → the members its placeholder lines stand for: only their sides are looked up
  const wanted = new Map<string, Set<string>>();
  for (const line of lines) {
    const member = memberOf.get(line.accountId);
    if (member === undefined) continue;
    wanted.set(line.transactionId, (wanted.get(line.transactionId) ?? new Set<string>()).add(member));
  }
  // transaction id → member → that member's item kind
  const kinds = new Map<string, Map<string, string>>();
  try {
    const transfers = await db.values<[string, string, string, string]>(sql`
      SELECT p.transaction_id, t.book_id, t.from_json, t.to_json FROM member_transfer_postings p
      JOIN member_transfers t ON t.book_id = p.book_id AND t.transfer_id = p.transfer_id
      WHERE p.transaction_id IN ${[...wanted.keys()]}`);
    const sides: { transactionId: string; groupBookId: string; owner: string; itemId: string }[] = [];
    for (const [transactionId, groupBookId, ...jsons] of transfers) {
      for (const json of jsons) {
        let side: { owner?: unknown; itemId?: unknown } | null = null;
        try {
          side = JSON.parse(json) as { owner?: unknown; itemId?: unknown } | null;
        } catch {
          continue;
        }
        if (typeof side?.owner !== 'string' || typeof side.itemId !== 'string' || side.itemId === '') continue;
        if (!wanted.get(transactionId)?.has(side.owner)) continue;
        sides.push({ transactionId, groupBookId, owner: side.owner, itemId: side.itemId });
      }
    }
    if (sides.length > 0) {
      const key = (bookId: string, itemId: string, owner: string) => `${bookId}\u0000${itemId}\u0000${owner}`;
      const subtypes = new Map<string, string>();
      for (const [bookId, itemId, owner, json] of await db.values<[string, string, string, string]>(
        sql`SELECT book_id, item_id, owner, summary_json FROM nw_items WHERE removed = 0 AND item_id IN ${[...new Set(sides.map((side) => side.itemId))]}`,
      )) {
        try {
          const subtype = (JSON.parse(json) as { subtype?: unknown } | null)?.subtype;
          if (typeof subtype === 'string') subtypes.set(key(bookId, itemId, owner), subtype);
        } catch {
          // A summary that does not parse names nothing.
        }
      }
      for (const side of sides) {
        const subtype = subtypes.get(key(side.groupBookId, side.itemId, side.owner));
        if (subtype === undefined) continue;
        kinds.set(side.transactionId, (kinds.get(side.transactionId) ?? new Map<string, string>()).set(side.owner, subtype));
      }
    }
  } catch {
    // a database from before the group log: no transfer between partners here
  }
  return {
    placeholders: new Set(memberOf.keys()),
    partnerSubtype: (transactionId, accountId) => {
      const member = memberOf.get(accountId);
      return member === undefined ? null : (kinds.get(transactionId)?.get(member) ?? null);
    },
  };
}
