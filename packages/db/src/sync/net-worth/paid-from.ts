import type { ItemSummary } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database';
import { activeNetWorthGroup } from '../../repos/net-worth-sharing';
import { bookContextTx, placeholderAccountTx } from '../apply';
import { receivedItems } from './summaries';

/*
 * Paid with the other's item (joint-net-worth §5.3, §7.1, D14; task 7). In the shared workspace's add form, Paid with
 * lists a group of the partner's shared items that can pay. Picking one posts the money side on the partner's
 * placeholder here (`paidFromAccount`) and tells the ledger `paidFrom`, which the purchase carries: on the partner's
 * phone it lands on the item's own account and card.
 */

/** The item kinds that can pay for something (§7.1): money held, and a credit card. */
export const PAYABLE_SUBTYPES: readonly string[] = ['bank', 'cash', 'ewallet', 'credit_card'];

/**
 * The other group members' shared items this form's book can pay with: the live ones that can pay, and only when
 * `bookId` is the workspace of this person's active net-worth group — outside it the group never appears (D14). An
 * item that stops being shared leaves this list; purchases already recorded stay.
 */
export async function paidWithItems(database: Database, bookId: string): Promise<PaidWithItem[]> {
  const group = await activeNetWorthGroup(database);
  if (!group || group.workspaceBookId !== bookId) return [];
  const members = new Set(group.members);
  const names = new Map(await database.db.values<[string, string]>(sql`SELECT member_id, name FROM book_members WHERE book_id = ${bookId}`));
  return (await receivedItems(database, group.groupBookId))
    .filter((item) => item.owner !== group.me && members.has(item.owner) && PAYABLE_SUBTYPES.includes(item.subtype))
    .map((item) => ({ ...item, ownerName: names.get(item.owner) || null }));
}

/** A partner's shared item Paid with can offer, with the name its owner goes by in the workspace (null when unknown here). */
export type PaidWithItem = ItemSummary & { itemId: string; ownerName: string | null };

/**
 * The account this device posts a purchase paid from `owner`'s item on (§5.3): `owner`'s placeholder in the book, in the
 * item's currency, made on first need. Never one of this device's own accounts.
 */
export async function paidFromAccount(database: Database, bookId: string, owner: string, currency: string): Promise<string> {
  return database.transaction(async (tx) => {
    const ctx = await bookContextTx(tx, bookId);
    if (owner === ctx.memberId) throw new Error('Your own items are paid with from your own accounts');
    return placeholderAccountTx(tx, ctx, owner, currency);
  });
}
