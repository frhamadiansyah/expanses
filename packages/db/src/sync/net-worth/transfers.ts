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

/** The transfer as stored in the group log, refused when this member is no party; whether it is void, and its two owners. */
async function editableTransfer(
  database: Database,
  workspaceBookId: string,
  transferId: string,
): Promise<{ groupBookId: string; me: string; members: string[]; parties: { void: boolean; owners: (string | null)[] } }> {
  const { groupBookId, me, members } = await groupOf(database, workspaceBookId);
  const [row] = await database.db.values<[string, string, number]>(
    sql`SELECT from_json, to_json, void FROM member_transfers WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`,
  );
  if (!row) throw new NetWorthError('not-listed', 'That transfer is not in your net-worth group');
  if (ownerOf(row[0]) !== me && ownerOf(row[1]) !== me) throw new NetWorthError('not-listed', 'Only the two people in a transfer can change it');
  return { groupBookId, me, members, parties: { void: Number(row[2]) === 1, owners: [ownerOf(row[0]), ownerOf(row[1])] } };
}

/** Either party changes its date, amount or note (§7.2); both sides follow. From, to and currency never change. */
export async function editMemberTransfer(database: Database, workspaceBookId: string, transferId: string, patch: MemberTransferPatch): Promise<void> {
  const { groupBookId, me, parties, members } = await editableTransfer(database, workspaceBookId, transferId);
  if (parties.void) throw new NetWorthError('invalid', 'That transfer was deleted');
  // Review round 1: never write a row this phone's side would not follow — a party who has left makes it delete-only.
  if (!parties.owners.every((owner) => owner !== null && members.includes(owner))) {
    throw new NetWorthError('left-group', 'The other person no longer shares net worth with you. This transfer can only be deleted.');
  }
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
  const { groupBookId, me, parties } = await editableTransfer(database, workspaceBookId, transferId);
  await database.transaction(async (tx) => {
    // Deleting it again does nothing more than make sure this phone's side is void (review round 1).
    if (!parties.void) {
      await withCapture(tx, { entity: 'member_transfer', id: transferId, bookId: groupBookId }, async () => {
        await tx.run(sql`UPDATE member_transfers SET void = 1 WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
      });
    }
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

/** A local transaction that is this phone's side of a transfer between partners: the transfer, and whether each is void. */
export interface MemberTransferPosting {
  groupBookId: string;
  transferId: string;
  /** The transfer is void in the group log. */
  transferVoid: boolean;
  /** This phone's side is already void. */
  sideVoid: boolean;
}

/** The transfer each of these local transactions posts, for the ones that are a transfer between partners' side here. */
export async function memberTransfersOf(database: Database, transactionIds: readonly string[]): Promise<Record<string, MemberTransferPosting>> {
  const out: Record<string, MemberTransferPosting> = {};
  if (transactionIds.length === 0) return out;
  const rows = await database.db.values<[string, string, string, number | null, string]>(sql`
    SELECT p.transaction_id, p.book_id, p.transfer_id, m.void, t.status FROM member_transfer_postings p
    JOIN transactions t ON t.id = p.transaction_id
    LEFT JOIN member_transfers m ON m.book_id = p.book_id AND m.transfer_id = p.transfer_id
    WHERE p.transaction_id IN (${sql.join(transactionIds.map((id) => sql`${id}`), sql`, `)})`);
  for (const [transactionId, groupBookId, transferId, voided, status] of rows) {
    out[transactionId] = { groupBookId, transferId, transferVoid: Number(voided ?? 0) === 1, sideVoid: status === 'void' };
  }
  return out;
}

/** A live transfer seen from one item's side (joint-net-worth §8.3 "Lines you can see"; task 9 × task 8). */
export interface ItemTransfer {
  transferId: string;
  occurredOn: string;
  /** The transfer's amount, in `currency` (always above zero; `direction` says which way it moved the item). */
  amountMinor: number;
  currency: string;
  description: string | null;
  /** `out` = the item is the transfer's `from` side, `in` = its `to` side. */
  direction: 'out' | 'in';
  /** The other side. */
  counterpart: MemberTransferSide;
  /** The other side's local account name when it is this phone's own item in this group; else null. */
  counterpartName: string | null;
}

/**
 * The live (non-void) transfers of the group log `groupBookId` dated within `period` with `itemId` on either side, oldest
 * first. Only group-log rows every member of the group already holds are read; the other side is named only when it is
 * this phone's own item, by its local account name, which never leaves the phone.
 */
export async function itemTransfers(
  database: Database,
  groupBookId: string,
  itemId: string,
  period: { start: string; end: string },
): Promise<ItemTransfer[]> {
  // One read: the period filter lives here and only here (the page does not filter again), and the other side's local
  // name comes with it. `CASE WHEN json_valid` guards json_extract, so a malformed row is skipped, never an error.
  const fromItem = sql`CASE WHEN json_valid(m.from_json) THEN json_extract(m.from_json, '$.itemId') END`;
  const toItem = sql`CASE WHEN json_valid(m.to_json) THEN json_extract(m.to_json, '$.itemId') END`;
  const rows = await database.db.values<[string, string, number, string, string | null, string, string, string | null]>(sql`
    SELECT m.transfer_id, m.occurred_on, m.amount_minor, m.currency, m.description, m.from_json, m.to_json, a.name
    FROM member_transfers m
    LEFT JOIN nw_item_map im ON im.group_book_id = m.book_id
      AND im.item_id = CASE WHEN ${fromItem} = ${itemId} THEN ${toItem} ELSE ${fromItem} END
    LEFT JOIN accounts a ON a.id = im.account_id
    WHERE m.book_id = ${groupBookId} AND m.void = 0 AND m.occurred_on >= ${period.start} AND m.occurred_on <= ${period.end}
      AND (${fromItem} = ${itemId} OR ${toItem} = ${itemId})
    ORDER BY m.occurred_on, m.transfer_id`);
  const out: ItemTransfer[] = [];
  for (const [transferId, occurredOn, amountMinor, currency, description, fromJson, toJson, name] of rows) {
    const from = sideOf(fromJson);
    const to = sideOf(toJson);
    if (!from || !to) continue;
    const direction = from.itemId === itemId ? 'out' : 'in';
    out.push({ transferId, occurredOn, amountMinor: Number(amountMinor), currency, description, direction, counterpart: direction === 'out' ? to : from, counterpartName: name ?? null });
  }
  return out;
}

/**
 * Tries again every transfer side this phone left unposted (review round 1): after each group-log sync, and after a rate
 * is saved — a rate, a mapped item or the group may be here now. Each is judged by the author it was left for. Returns
 * how many now post.
 */
export async function retryUnpostedTransfers(database: Database, groupBookId?: string): Promise<number> {
  // A database stopped before migration 0059 (a rate saved while migrating) has nothing waiting.
  if ((await database.db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'member_transfer_unposted'`)).length === 0) return 0;
  const rows = await database.db.values<[string, string, string | null]>(
    groupBookId === undefined
      ? sql`SELECT book_id, transfer_id, author FROM member_transfer_unposted ORDER BY book_id, transfer_id`
      : sql`SELECT book_id, transfer_id, author FROM member_transfer_unposted WHERE book_id = ${groupBookId} ORDER BY transfer_id`,
  );
  let posted = 0;
  for (const [book, transferId, author] of rows) {
    const done = await database.transaction(async (tx) => {
      await postTransferSideTx(tx, book, transferId, author);
      return (await tx.values(sql`SELECT 1 FROM member_transfer_unposted WHERE book_id = ${book} AND transfer_id = ${transferId}`)).length === 0;
    });
    if (done) posted += 1;
  }
  return posted;
}

/** units of `base` per one unit of `currency` this device knows, on or before `on` — else its latest — or null. */
async function rateOf(tx: Tx, currency: string, base: string, on: string): Promise<number | null> {
  const [row] = await tx.values<[number]>(sql`
    SELECT rate FROM fx_rates WHERE from_currency = ${currency} AND to_currency = ${base}
    ORDER BY (on_date <= ${on}) DESC, CASE WHEN on_date <= ${on} THEN on_date END DESC, on_date DESC LIMIT 1`);
  const rate = row ? Number(row[0]) : NaN;
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

async function setUnposted(tx: Tx, groupBookId: string, transferId: string, reason: UnpostedReason | null, author: string | null = null): Promise<void> {
  if (reason === null) {
    await tx.run(sql`DELETE FROM member_transfer_unposted WHERE book_id = ${groupBookId} AND transfer_id = ${transferId}`);
    return;
  }
  await tx.run(sql`
    INSERT INTO member_transfer_unposted (book_id, transfer_id, reason, author) VALUES (${groupBookId}, ${transferId}, ${reason}, ${author})
    ON CONFLICT (book_id, transfer_id) DO UPDATE SET reason = excluded.reason, author = excluded.author`);
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
  const unposted = (reason: UnpostedReason) => setUnposted(tx, groupBookId, transferId, reason, author);
  const from = sideOf(fromJson);
  const to = sideOf(toJson);
  const amountMinor = Number(amount);
  if (!from || !to || from.owner === to.owner || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return unposted('malformed');

  const [posted] = await tx.values<[string, string]>(sql`
    SELECT p.transaction_id, t.status FROM member_transfer_postings p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.book_id = ${groupBookId} AND p.transfer_id = ${transferId}`);
  // Void wins for ever: a side voided here is never posted again.
  if (posted && posted[1] === 'void') return setUnposted(tx, groupBookId, transferId, null);
  // Review round 1 (ruling): a void of this phone's own posted side always goes through, whoever sent it and whatever
  // the group now is — voiding only undoes a movement, it never lands money anywhere.
  if (Number(voided) === 1) {
    if (posted) {
      const { ws } = await bookContextTx(tx, groupBookId);
      await withCaptureSuspended(tx, () => voidTransactionTx(tx, ws, posted[0], {}, author ?? undefined));
    }
    return setUnposted(tx, groupBookId, transferId, null);
  }

  const group = await activeNetWorthGroup(tx);
  if (!group || group.groupBookId !== groupBookId) return unposted('group-inactive');
  if (author === null || !group.members.includes(author)) return unposted('author-not-member');
  if (!group.members.includes(from.owner) || !group.members.includes(to.owner)) return unposted('party-not-member');
  const ctx = await bookContextTx(tx, group.workspaceBookId);

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
