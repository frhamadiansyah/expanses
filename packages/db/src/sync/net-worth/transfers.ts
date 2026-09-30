import { isSupportedCurrency, type PostingLine, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { Database, Db, Tx } from '../../database';
import { postTransactionTx, replaceTransactionTx, voidTransactionTx, type PostTransactionInput } from '../../repos/ledger';
import { activeNetWorthGroup, NetWorthError, type ActiveNetWorthGroup } from '../../repos/net-worth-sharing';
import { bookContextTx, placeholderAccountTx } from '../apply';
import { withCapture, withCaptureSuspended } from '../capture';
import { receivedItems } from './summaries';

/*
 * Transfers between partners (joint-net-worth §7.2, D15; task 8). One `member_transfer` row in the group log — never the
 * workspace log — and each party's phone posts only its own side, through the ledger doors, with capture off: the
 * posting belongs to no workspace book and is never emitted.
 *
 * - the `from` owner's phone: their `from` account −amount, the `to` owner's placeholder +amount;
 * - the `to` owner's phone: their `to` account +amount, the `from` owner's placeholder −amount;
 * - any other phone: nothing.
 *
 * Placeholders are outside Net worth (S4.4), so the payer's drops by the amount and the receiver's rises by it. The local
 * transaction is kept in `member_transfer_postings`; an edit replaces it, a void voids it, and void wins for ever.
 *
 * Who may land one on a real account (the task 7 trust rule, applied to transfers): only while this person's group is
 * active and is this log's, both parties are in it, and the transfer's author — the signing device's member in the
 * authority view, never a change-set's claim — is a member. Otherwise nothing is posted or changed here, and why is kept
 * in `member_transfer_unposted`.
 */

/** One side of a transfer: a group member's shared item, by its opaque id (never a local account id). */
export interface MemberTransferSide {
  owner: string;
  itemId: string;
}

export interface MemberTransferInput {
  occurredOn: string;
  amountMinor: number;
  currency: string;
  from: MemberTransferSide;
  to: MemberTransferSide;
  description: string | null;
}

export type MemberTransferPatch = Partial<{ occurredOn: string; amountMinor: number; description: string | null }>;

/** Why this device posted nothing for a transfer it is a party of. */
export type UnpostedReason = 'group-inactive' | 'author-not-member' | 'party-not-member' | 'item-not-here' | 'no-rate' | 'malformed';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function sideOf(value: unknown): MemberTransferSide | null {
  try {
    const parsed = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown> | null;
    return parsed && typeof parsed.owner === 'string' && typeof parsed.itemId === 'string' ? { owner: parsed.owner, itemId: parsed.itemId } : null;
  } catch {
    return null;
  }
}

function ownerOf(value: unknown): string | null {
  try {
    const parsed = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown> | null;
    return parsed && typeof parsed.owner === 'string' ? parsed.owner : null;
  } catch {
    return null;
  }
}

/** The active group, when it is this workspace's: the only place a transfer between partners is recorded or changed. */
async function groupOf(database: Database, workspaceBookId: string): Promise<ActiveNetWorthGroup> {
  const group = await activeNetWorthGroup(database);
  if (!group || group.workspaceBookId !== workspaceBookId) throw new NetWorthError('not-listed', "You're not in this workspace's net-worth group");
  return group;
}

function checkAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new NetWorthError('invalid', 'Enter an amount above zero');
}

function checkDate(occurredOn: string): void {
  if (!DATE.test(occurredOn)) throw new NetWorthError('invalid', 'Pick a date');
}

/** This member's own shared item as a local account, and its currency: live in the log, mapped here, not a placeholder. */
async function ownItemAccount(db: Db, groupBookId: string, me: string, itemId: string): Promise<{ accountId: string; currency: string | null } | null> {
  const [row] = await db.values<[string, string | null]>(sql`
    SELECT m.account_id, a.currency FROM nw_item_map m
    JOIN accounts a ON a.id = m.account_id
    JOIN nw_items i ON i.book_id = m.group_book_id AND i.item_id = m.item_id AND i.owner = ${me} AND i.removed = 0
    WHERE m.item_id = ${itemId} AND m.group_book_id = ${groupBookId}
      AND a.kind IN ('asset', 'liability') AND a.id NOT IN (SELECT account_id FROM book_member_accounts)`);
  return row ? { accountId: row[0], currency: row[1] } : null;
}

/**
 * Records a transfer between this member and a partner in the group (§7.2): this member is `from` (money sent) or `to`
 * (money received). Both items must be shared and live, and in `currency`. Posts this device's side at once; the
 * partner's phone posts theirs when it syncs. Returns the transfer's id.
 */
export async function recordMemberTransfer(database: Database, workspaceBookId: string, t: MemberTransferInput): Promise<string> {
  const group = await groupOf(database, workspaceBookId);
  const { me, groupBookId } = group;
  checkDate(t.occurredOn);
  checkAmount(t.amountMinor);
  if (!isSupportedCurrency(t.currency)) throw new NetWorthError('invalid', `Unsupported currency ${t.currency}`);
  if (t.from.owner === t.to.owner || (t.from.owner !== me && t.to.owner !== me)) throw new NetWorthError('invalid', 'A transfer is between you and a partner');
  const mine = t.from.owner === me ? t.from : t.to;
  const theirs = t.from.owner === me ? t.to : t.from;
  if (!group.members.includes(theirs.owner)) throw new NetWorthError('invalid', 'That person is not in your net-worth group');
  const own = await ownItemAccount(database.db, groupBookId, me, mine.itemId);
  if (!own) throw new NetWorthError('item-not-shared', 'Your account is not shared with the household. Share it first, or pick another.');
  const partner = (await receivedItems(database, groupBookId)).find((item) => item.itemId === theirs.itemId && item.owner === theirs.owner);
  if (!partner) throw new NetWorthError('item-not-shared', 'That item is no longer shared. Pick another.');
  if (own.currency !== t.currency || partner.currency !== t.currency) throw new NetWorthError('invalid', `Both accounts must be in ${t.currency}`);

  const transferId = uuidv7();
  await database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'member_transfer', id: transferId, bookId: groupBookId }, async () => {
      await tx.run(sql`
        INSERT INTO member_transfers (book_id, transfer_id, occurred_on, amount_minor, currency, from_json, to_json, description, void, recorded_by)
        VALUES (${groupBookId}, ${transferId}, ${t.occurredOn}, ${t.amountMinor}, ${t.currency},
                ${JSON.stringify({ owner: t.from.owner, itemId: t.from.itemId })}, ${JSON.stringify({ owner: t.to.owner, itemId: t.to.itemId })},
                ${t.description?.trim() || null}, 0, ${me})`);
    });
    await postTransferSideTx(tx, groupBookId, transferId, me);
  });
  return transferId;
}

/** The transfer as stored in the group log, or `not-found`; refused when void (void wins) or this member is no party. */
async function editableTransfer(database: Database, workspaceBookId: string, transferId: string): Promise<{ groupBookId: string; me: string }> {
  const { groupBookId, me } = await groupOf(database, workspaceBookId);
  const [row] = await database.db.values<[string, string, number]>(
    sql`SELECT from_json, to_json, void FROM member_transfers WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`,
  );
  if (!row) throw new NetWorthError('not-listed', 'That transfer is not in your net-worth group');
  if (Number(row[2]) === 1) throw new NetWorthError('invalid', 'That transfer was deleted');
  if (ownerOf(row[0]) !== me && ownerOf(row[1]) !== me) throw new NetWorthError('not-listed', 'Only the two people in a transfer can change it');
  return { groupBookId, me };
}

/** Either party changes its date, amount or note (§7.2); both sides follow. From, to and currency never change. */
export async function editMemberTransfer(database: Database, workspaceBookId: string, transferId: string, patch: MemberTransferPatch): Promise<void> {
  const { groupBookId, me } = await editableTransfer(database, workspaceBookId, transferId);
  if (patch.occurredOn !== undefined) checkDate(patch.occurredOn);
  if (patch.amountMinor !== undefined) checkAmount(patch.amountMinor);
  const sets = [
    patch.occurredOn !== undefined ? sql`occurred_on = ${patch.occurredOn}` : null,
    patch.amountMinor !== undefined ? sql`amount_minor = ${patch.amountMinor}` : null,
    patch.description !== undefined ? sql`description = ${patch.description?.trim() || null}` : null,
  ].filter((s) => s !== null);
  if (sets.length === 0) return;
  await database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'member_transfer', id: transferId, bookId: groupBookId }, async () => {
      await tx.run(sql`UPDATE member_transfers SET ${sql.join(sets, sql`, `)} WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
    });
    await postTransferSideTx(tx, groupBookId, transferId, me);
  });
}

/** Either party deletes it (§7.2): both sides are voided, and void wins for ever. */
export async function voidMemberTransfer(database: Database, workspaceBookId: string, transferId: string): Promise<void> {
  const { groupBookId, me } = await editableTransfer(database, workspaceBookId, transferId);
  await database.transaction(async (tx) => {
    await withCapture(tx, { entity: 'member_transfer', id: transferId, bookId: groupBookId }, async () => {
      await tx.run(sql`UPDATE member_transfers SET void = 1 WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
    });
    await postTransferSideTx(tx, groupBookId, transferId, me);
  });
}

/** Transfers this device is a party of and posted nothing for, with why (`member_transfer_unposted`). */
export async function memberTransferUnposted(database: Database, groupBookId: string): Promise<{ transferId: string; reason: UnpostedReason }[]> {
  const rows = await database.db.values<[string, string]>(
    sql`SELECT transfer_id, reason FROM member_transfer_unposted WHERE book_id = ${groupBookId} ORDER BY transfer_id`,
  );
  return rows.map(([transferId, reason]) => ({ transferId, reason: reason as UnpostedReason }));
}

/** The transfer each of these local transactions posts, for the ones that are a transfer between partners' side here. */
export async function memberTransfersOf(database: Database, transactionIds: readonly string[]): Promise<Record<string, { groupBookId: string; transferId: string }>> {
  const out: Record<string, { groupBookId: string; transferId: string }> = {};
  if (transactionIds.length === 0) return out;
  try {
    const rows = await database.db.values<[string, string, string]>(
      sql`SELECT transaction_id, book_id, transfer_id FROM member_transfer_postings WHERE transaction_id IN (${sql.join(transactionIds.map((id) => sql`${id}`), sql`, `)})`,
    );
    for (const [transactionId, groupBookId, transferId] of rows) out[transactionId] = { groupBookId, transferId };
  } catch {
    // A database from before migration 0057 has no transfers between partners.
  }
  return out;
}

/** units of `base` per one unit of `currency` this device knows, on or before `on` — else its latest — or null. */
async function rateOf(tx: Tx, currency: string, base: string, on: string): Promise<number | null> {
  const [row] = await tx.values<[number]>(sql`
    SELECT rate FROM fx_rates WHERE from_currency = ${currency} AND to_currency = ${base}
    ORDER BY (on_date <= ${on}) DESC, CASE WHEN on_date <= ${on} THEN on_date END DESC, on_date DESC LIMIT 1`);
  const rate = row ? Number(row[0]) : NaN;
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

async function setUnposted(tx: Tx, groupBookId: string, transferId: string, reason: UnpostedReason | null): Promise<void> {
  if (reason === null) {
    await tx.run(sql`DELETE FROM member_transfer_unposted WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
    return;
  }
  await tx.run(sql`
    INSERT INTO member_transfer_unposted (book_id, transfer_id, reason) VALUES (${groupBookId}, ${transferId}, ${reason})
    ON CONFLICT (book_id, transfer_id) DO UPDATE SET reason = excluded.reason`);
}

/**
 * Brings this device's side of a transfer in line with its row in the group log (§7.2): posted, replaced, voided, or left
 * alone. `author` is the member whose change this is — the authority view's, for a peer's op; this member, for its own
 * write. Inside the caller's transaction; the ledger writes run with capture off.
 */
export async function postTransferSideTx(tx: Tx, groupBookId: string, transferId: string, author: string | null): Promise<void> {
  const [row] = await tx.values<[string, number, string, string, string, string | null, number]>(sql`
    SELECT occurred_on, amount_minor, currency, from_json, to_json, description, void
    FROM member_transfers WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
  if (!row) return;
  const [occurredOn, amount, currency, fromJson, toJson, description, voided] = row;
  const [self] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${groupBookId}`);
  if (!self) return;
  const me = self[0];
  // Any other phone posts nothing, and has nothing to say about it.
  if (ownerOf(fromJson) !== me && ownerOf(toJson) !== me) return;
  const unposted = (reason: UnpostedReason) => setUnposted(tx, groupBookId, transferId, reason);
  const from = sideOf(fromJson);
  const to = sideOf(toJson);
  const amountMinor = Number(amount);
  if (!from || !to || from.owner === to.owner || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return unposted('malformed');

  const [posted] = await tx.values<[string, string]>(sql`
    SELECT p.transaction_id, t.status FROM member_transfer_postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.book_id = ${groupBookId} AND p.transfer_id = ${transferId}`);
  // Void wins for ever: a side voided here is never posted again.
  if (posted && posted[1] === 'void') return setUnposted(tx, groupBookId, transferId, null);

  const group = await activeNetWorthGroup(tx);
  if (!group || group.groupBookId !== groupBookId) return unposted('group-inactive');
  if (author === null || !group.members.includes(author)) return unposted('author-not-member');
  if (!group.members.includes(from.owner) || !group.members.includes(to.owner)) return unposted('party-not-member');
  const ctx = await bookContextTx(tx, group.workspaceBookId);

  if (Number(voided) === 1) {
    if (posted) await withCaptureSuspended(tx, () => voidTransactionTx(tx, ctx.ws, posted[0], {}, author));
    return setUnposted(tx, groupBookId, transferId, null);
  }

  const side = from.owner === me ? 'from' : 'to';
  const mine = side === 'from' ? from : to;
  const other = side === 'from' ? to.owner : from.owner;
  const [account] = await tx.values<[string]>(sql`
    SELECT m.account_id FROM nw_item_map m JOIN accounts a ON a.id = m.account_id
    WHERE m.item_id = ${mine.itemId} AND m.group_book_id = ${groupBookId} AND a.currency = ${currency}
      AND a.kind IN ('asset', 'liability') AND a.id NOT IN (SELECT account_id FROM book_member_accounts)`);
  if (!account) return unposted('item-not-here');
  const ratesToBase: Record<string, number> = {};
  if (currency !== ctx.ws.baseCurrency) {
    const rate = await rateOf(tx, currency, ctx.ws.baseCurrency, occurredOn);
    if (rate === null) return unposted('no-rate');
    ratesToBase[currency] = rate;
  }
  const [name] = await tx.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${group.workspaceBookId} AND member_id = ${other}`);
  const who = name?.[0] || 'your partner';
  const sign = side === 'from' ? -1 : 1;
  const lines: PostingLine[] = [
    { accountId: account[0], amountMinor: sign * amountMinor, currency },
    { accountId: await placeholderAccountTx(tx, ctx, other, currency), amountMinor: -sign * amountMinor, currency },
  ];
  const input: PostTransactionInput = {
    occurredOn,
    description: description?.trim() || (side === 'from' ? `Transfer to ${who}` : `Transfer from ${who}`),
    lines,
    ratesToBase,
    syncAuthor: author,
  };

  await withCaptureSuspended(tx, async () => {
    if (!posted) {
      const id = await postTransactionTx(tx, ctx.ws, input);
      await tx.run(sql`INSERT INTO member_transfer_postings (book_id, transfer_id, transaction_id) VALUES (${groupBookId}, ${transferId}, ${id})`);
      return;
    }
    if (await postsAs(tx, posted[0], input)) return;
    const id = await replaceTransactionTx(tx, ctx.ws, posted[0], input);
    await tx.run(sql`UPDATE member_transfer_postings SET transaction_id = ${id} WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
  });
  await setUnposted(tx, groupBookId, transferId, null);
}

/** Whether a posted side already reads as `input`: its date, note and every line — nothing to replace. */
async function postsAs(tx: Tx, transactionId: string, input: PostTransactionInput): Promise<boolean> {
  const [head] = await tx.values<[string, string]>(sql`SELECT occurred_on, description FROM transactions WHERE id = ${transactionId}`);
  if (!head || head[0] !== input.occurredOn || head[1] !== input.description.trim()) return false;
  const entries = await tx.values<[string, number]>(sql`SELECT account_id, amount_minor FROM entries WHERE transaction_id = ${transactionId}`);
  const key = (pairs: [string, number][]) => pairs.map(([a, m]) => `${a}:${m}`).sort().join(',');
  return key(entries.map(([a, m]) => [a, Number(m)])) === key(input.lines.map((l) => [l.accountId, l.amountMinor]));
}
