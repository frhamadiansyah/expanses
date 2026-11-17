import { CARD_CASHBACK } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { withCapture } from '../sync/capture';
import { namespaceOf, uuidv5 } from '../sync/uuidv5';
import { hasBooks, personalBookIdTx } from './books';

/** Where Cashback & Rewards is drawn among the top-level spending categories: near the end, before Uncategorised. */
const CARD_CASHBACK_SORT = 998;

/**
 * The id Cashback & Rewards into a credit card has in a book (or, before books, a workspace): the same on every device
 * without any device telling the others, so two phones of one shared workspace saving their first cashback offline
 * make one category, not two.
 */
export async function cardCashbackIdOf(bookOrWorkspaceId: string): Promise<string> {
  return uuidv5(await namespaceOf(bookOrWorkspaceId), `category:${CARD_CASHBACK.key}`);
}

/**
 * Cashback & Rewards in one book, inserted if absent. A row already holding the id keeps whatever it carries (renamed,
 * archived): it was put that way on purpose. Capture is the caller's.
 */
async function ensureCardCashbackRowTx(tx: Db, workspaceId: string, bookId: string | null): Promise<string> {
  const id = await cardCashbackIdOf(bookId ?? workspaceId);
  const [found] = await tx.values<[string]>(sql`SELECT id FROM accounts WHERE id = ${id}`);
  if (!found) {
    await tx.run(sql`
      INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, system_key, sort_order, archived_at, created_at)
      VALUES (${id}, ${workspaceId}, NULL, ${CARD_CASHBACK.kind}, 'category', ${CARD_CASHBACK.name}, NULL, NULL, ${CARD_CASHBACK.key}, ${CARD_CASHBACK_SORT}, NULL, ${new Date().toISOString()})`);
    if (bookId) await tx.run(sql`INSERT INTO book_categories (category_account_id, workspace_id, book_id) VALUES (${id}, ${workspaceId}, ${bookId})`);
  }
  return id;
}

/**
 * The open book's Cashback & Rewards (`CARD_CASHBACK`), made the first time cashback into a credit card is saved and
 * reused after. It sits at the top of the spending tree, so no parent's budget counts it.
 */
export async function cardCashbackCategory(database: Database, ws: WorkspaceContext): Promise<string> {
  return database.transaction(async (tx) => {
    const bookId = (await hasBooks(tx)) ? (ws.bookId ?? (await personalBookIdTx(tx, ws.workspaceId))) : null;
    const id = await cardCashbackIdOf(bookId ?? ws.workspaceId);
    return withCapture(tx, { entity: 'category', id }, () => ensureCardCashbackRowTx(tx, ws.workspaceId, bookId));
  });
}
