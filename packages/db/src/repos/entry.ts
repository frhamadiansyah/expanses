import { merchantKey } from '@expanses/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';

/** How far back to look for a merchant already seen. Enough for a year of daily spending. */
const HISTORY_LIMIT = 3000;

/**
 * The category last used for the same merchant, to fill in a typed row before the owner has to.
 *
 * Learned from the owner's own spending rather than a list shipped with the app, so it knows the
 * warung round the corner as well as any chain, and it follows a change of mind: re-filing Superindo
 * from Groceries to Supplies makes Supplies the next guess. A purchase split across categories says
 * nothing about any one of them, so it is skipped.
 */
export async function guessCategoryFromHistory(database: Database, ws: WorkspaceContext, description: string): Promise<string | null> {
  const key = merchantKey(description);
  if (!key) return null;
  const rows = await database.db
    .select({ transactionId: transactions.id, description: transactions.description, categoryId: entries.accountId })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(accounts.kind, 'expense'),
        // A guess is offered to a form that records into one workspace, so it may only offer that workspace's
        // categories: anything else the posting would refuse a moment later.
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(HISTORY_LIMIT);

  const perTransaction = new Map<string, { description: string; categories: Set<string> }>();
  for (const row of rows) {
    const seen = perTransaction.get(row.transactionId) ?? { description: row.description, categories: new Set<string>() };
    seen.categories.add(row.categoryId);
    perTransaction.set(row.transactionId, seen);
  }
  // Map keeps insertion order, and rows arrived newest first. The same name is the best evidence; failing
  // that, one name that begins with the other's words ("Superindo" and "Superindo Kebayoran").
  const words = key.split(' ');
  const startsWith = (longer: string[], shorter: string[]) => shorter.every((word, i) => longer[i] === word);
  let near: string | null = null;
  for (const { description: seenDescription, categories } of perTransaction.values()) {
    if (categories.size !== 1) continue;
    const seen = merchantKey(seenDescription);
    if (seen === key) return [...categories][0]!;
    const seenWords = seen.split(' ');
    if (near === null && seen && (startsWith(seenWords, words) || startsWith(words, seenWords))) near = [...categories][0]!;
  }
  return near;
}

/** A note written before, offered back while a new one is typed, with the category it was last filed under. */
export interface NoteSuggestion {
  description: string;
  /** Null when the last one was split across categories: it says nothing about any one of them. */
  categoryId: string | null;
}

/**
 * Whether a note written before is worth offering for what is being typed: it begins with the typed text, or one of
 * its words does — "Grabfood G" and "gudeg" both find "Grabfood Gudeg Jogja". Case and runs of spaces do not count.
 * Nothing under two letters, and never the note already typed in full.
 */
export function noteMatches(description: string, typed: string): boolean {
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const seen = flat(description);
  const want = flat(typed);
  if (want.length < 2 || seen === want) return false;
  if (seen.startsWith(want)) return true;
  return seen.split(' ').some((_, i, words) => words.slice(i).join(' ').startsWith(want));
}

/** Past transactions filed under a category of this kind, newest first, each with the categories it touched. */
async function filedHistory(database: Database, ws: WorkspaceContext, kind: 'expense' | 'income') {
  const rows = await database.db
    .select({ transactionId: transactions.id, description: transactions.description, categoryId: entries.accountId })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(
      and(
        eq(entries.workspaceId, ws.workspaceId),
        eq(transactions.status, 'posted'),
        eq(accounts.kind, kind),
        ...(ws.bookId ? [sql`${entries.accountId} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${ws.bookId})`] : []),
      ),
    )
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(HISTORY_LIMIT);
  const perTransaction = new Map<string, { description: string; categories: Set<string> }>();
  for (const row of rows) {
    const seen = perTransaction.get(row.transactionId) ?? { description: row.description, categories: new Set<string>() };
    seen.categories.add(row.categoryId);
    perTransaction.set(row.transactionId, seen);
  }
  return [...perTransaction.values()];
}

const flatNote = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Notes already written for this kind of transaction, newest first and each only once, that match what is being
 * typed — the suggestions over the keyboard in New transaction. Only notes filed under a category of the open
 * workspace, so a pick never brings a category the posting would refuse.
 */
export async function noteSuggestions(
  database: Database,
  ws: WorkspaceContext,
  typed: string,
  kind: 'expense' | 'income',
  limit = 3,
): Promise<NoteSuggestion[]> {
  if (typed.trim().length < 2) return [];
  const found: NoteSuggestion[] = [];
  const named = new Set<string>();
  for (const { description, categories } of await filedHistory(database, ws, kind)) {
    const name = description.trim();
    const key = flatNote(name);
    if (!name || named.has(key) || !noteMatches(name, typed)) continue;
    named.add(key);
    found.push({ description: name, categoryId: categories.size === 1 ? [...categories][0]! : null });
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * The category a note typed out in full was last filed under, for Category when it is still empty. A purchase
 * goes through the merchant guess, which also knows a shop written shorter or longer; income takes the same note.
 */
export async function noteCategory(database: Database, ws: WorkspaceContext, typed: string, kind: 'expense' | 'income'): Promise<string | null> {
  if (kind === 'expense') return guessCategoryFromHistory(database, ws, typed);
  const want = flatNote(typed);
  if (!want) return null;
  for (const { description, categories } of await filedHistory(database, ws, kind)) {
    if (flatNote(description) === want) return categories.size === 1 ? [...categories][0]! : null;
  }
  return null;
}
