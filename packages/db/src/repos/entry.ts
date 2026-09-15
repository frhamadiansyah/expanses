import { merchantKey } from '@expanses/core';
import { and, desc, eq } from 'drizzle-orm';
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
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), eq(accounts.kind, 'expense')))
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
