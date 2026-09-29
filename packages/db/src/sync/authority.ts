import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { termsSigningBytes } from './invite';
import { deviceIdOf, verifySignature } from './relay-signing';
import { entityOf, parseOpId, type RowEntity } from './shared-entities';
import type { ChangeSet, Op } from './types';

/*
 * Who may write what (spec §5.4, §8.2, §8.4, §8.5; task 5 fix rounds 1–2).
 *
 * Every decision reads the **authority view** — `sync_authority` (members: role, deleted) and `sync_authority_devices`
 * (devices: their member, the seq that removed them) — never `book_members` or `book_devices`. The view changes only as
 * log entries are applied, in seq order, this device's own entries included at their seq; a local edit not yet synced
 * never touches it. Every device therefore reaches the same answer for the same entry, and a refusal is a recorded
 * skip on all of them alike (§7.1): never applied, never a reason to rotate.
 *
 * - A device row is its own device's: only its author writes it; its keys are fixed by its introduction and its
 *   `removedAt` only by a removal entry (C1).
 * - A removal of another device needs an owner (C2); a removed device's later entries count for nothing (I2).
 * - An introduction after the book's first entry carries an owner's signed invite terms, joins as a new member or as
 *   the member they name, once per invite (C3).
 * - Only an owner writes a role, deletes a member row or makes one again; a new member introduces itself as 'member';
 *   the last owner is never deleted or demoted (C3, N1, §8.5).
 */

/**
 * Member ops by a non-owner that must not bring a deleted member row back or move its existence clock: a rename that
 * crossed an owner's delete stays dead (merged into what the tombstone kept), on every device alike (N1).
 */
export const NO_REVIVE = new WeakSet<Op>();

/** Whether an upsert of a member row makes it (names every field), rather than editing one that exists. */
export function makesMember(op: Op): boolean {
  if (op.op !== 'upsert') return false;
  const named = op.changed ?? Object.keys(op.fields);
  return ['name', 'role', 'joinedAt'].every((f) => named.includes(f));
}

/** Why an op or entry is refused; the text goes into `sync_skipped.error`. */
export class AuthorityError extends Error {
  constructor(message: string) {
    super(`AUTHORITY: ${message}`);
    this.name = 'SkipOp';
  }
}

interface ViewMember {
  role: string;
  roleHlc: string;
  deleted: boolean;
  rowHlc: string;
}

export async function viewMember(tx: Db, bookId: string, memberId: string): Promise<ViewMember | null> {
  const [row] = await tx.values<[string, string, number, string]>(
    sql`SELECT role, role_hlc, deleted, row_hlc FROM sync_authority WHERE book_id = ${bookId} AND member_id = ${memberId}`,
  );
  return row ? { role: row[0], roleHlc: row[1], deleted: Number(row[2]) === 1, rowHlc: row[3] } : null;
}

export async function viewDevice(
  tx: Db,
  bookId: string,
  deviceId: string,
): Promise<{ memberId: string; removedSeq: number | null; addedSeq: number | null } | null> {
  const [row] = await tx.values<[string, number | null, number | null]>(
    sql`SELECT member_id, removed_seq, added_seq FROM sync_authority_devices WHERE book_id = ${bookId} AND device_id = ${deviceId}`,
  );
  return row ? { memberId: row[0], removedSeq: row[1] === null ? null : Number(row[1]), addedSeq: row[2] === null ? null : Number(row[2]) } : null;
}

/**
 * Leave's guard (§8.4, fix round 1): the owner members other than `memberId` that still have a device in, per the view.
 * An owner member whose every device is gone cannot run the book, so it does not count.
 */
export async function viewOtherActiveOwners(tx: Db, bookId: string, memberId: string): Promise<number> {
  const [row] = await tx.values<[number]>(sql`
    SELECT count(DISTINCT m.member_id) FROM sync_authority m JOIN sync_authority_devices d ON d.book_id = m.book_id AND d.member_id = m.member_id
    WHERE m.book_id = ${bookId} AND m.member_id <> ${memberId} AND m.role = 'owner' AND m.deleted = 0 AND d.removed_seq IS NULL`);
  return Number(row?.[0] ?? 0);
}

/** The role of the member a device belongs to, per the view: none for a device removed, or whose member is deleted. */
export async function viewRoleOfDevice(tx: Db, bookId: string, deviceId: string): Promise<string | null> {
  const device = await viewDevice(tx, bookId, deviceId);
  if (!device || device.removedSeq !== null) return null;
  const member = await viewMember(tx, bookId, device.memberId);
  return member && !member.deleted ? member.role : null;
}

/**
 * The member `deviceId` writes as, per the view: null for a device the view does not know, one removed, or one whose
 * member is deleted (mirrors `viewRoleOfDevice`). What `decideRowWriter` (joint-net-worth spec §5.1) checks the
 * writer-bearing fields against — never a change-set's own claimed `member`, which the sender asserts and nothing
 * signs (task 1 review round 1, finding 1).
 */
export async function authorMemberOf(tx: Db, bookId: string, deviceId: string): Promise<string | null> {
  const device = await viewDevice(tx, bookId, deviceId);
  if (!device || device.removedSeq !== null) return null;
  const member = await viewMember(tx, bookId, device.memberId);
  return member && !member.deleted ? device.memberId : null;
}

/**
 * Whether `memberId` is, per the view, the book's last owner — an owner, and no other owner member has a device still
 * in (task 9a fix round 2: an owner whose devices are all gone cannot run the book, so it does not count). What
 * `withCapture`'s last-owner guard reads, never this device's own rows (fix round 3), and what apply decides by.
 */
export async function viewIsLastOwner(tx: Db, bookId: string, memberId: string): Promise<boolean> {
  const member = await viewMember(tx, bookId, memberId);
  return member !== null && !member.deleted && member.role === 'owner' && (await viewOtherActiveOwners(tx, bookId, memberId)) === 0;
}

/** The devices of owner members that are still in, per the view, by id — what the relay's owner set should be (§8.5). */
export async function viewOwnerDevices(tx: Db, bookId: string): Promise<string[]> {
  const rows = await tx.values<[string]>(sql`
    SELECT d.device_id FROM sync_authority_devices d JOIN sync_authority m ON m.book_id = d.book_id AND m.member_id = d.member_id
    WHERE d.book_id = ${bookId} AND d.removed_seq IS NULL AND m.deleted = 0 AND m.role = 'owner' ORDER BY d.device_id`);
  return rows.map(([id]) => id);
}

/** The devices still in, per the view — who a rotation seals for (§8.4). */
export async function viewActiveDevices(tx: Db, bookId: string): Promise<string[]> {
  const rows = await tx.values<[string]>(sql`SELECT device_id FROM sync_authority_devices WHERE book_id = ${bookId} AND removed_seq IS NULL ORDER BY device_id`);
  return rows.map(([id]) => id);
}

/** Forgets the view of a book, before a rejoin pulls the whole log again (§8.7). */
export async function clearAuthorityTx(tx: Db, bookId: string): Promise<void> {
  await tx.run(sql`DELETE FROM sync_authority WHERE book_id = ${bookId}`);
  await tx.run(sql`DELETE FROM sync_authority_devices WHERE book_id = ${bookId}`);
  await tx.run(sql`DELETE FROM sync_invites_used WHERE book_id = ${bookId}`);
}

/** I2: the author was removed at an earlier position in the log — whatever it wrote after counts for nothing. */
export async function removedInView(tx: Db, bookId: string, author: string): Promise<boolean> {
  return (await viewDevice(tx, bookId, author))?.removedSeq != null;
}

/** §8.4 (C2): a removal counts when a device removes itself, or its author's member is an owner (per the view). */
export async function removalRefusal(tx: Db, bookId: string, author: string, target: string): Promise<string | null> {
  if (author === target) return null;
  if ((await viewRoleOfDevice(tx, bookId, author)) === 'owner') return null;
  return 'AUTHORITY: only an owner removes another device';
}

export async function recordRemovalTx(tx: Db, bookId: string, target: string, seq: number): Promise<void> {
  await tx.run(sql`UPDATE sync_authority_devices SET removed_seq = ${seq} WHERE book_id = ${bookId} AND device_id = ${target} AND removed_seq IS NULL`);
}

/** An earlier introduction of this device was refused: its later entries are skipped the same way, not a stop. */
export async function wasRefused(tx: Db, bookId: string, deviceId: string): Promise<boolean> {
  const rows = await tx.values(sql`SELECT 1 FROM sync_skipped WHERE book_id = ${bookId} AND entity = 'device' AND id = ${deviceId} AND error LIKE '%AUTHORITY: introduction%'`);
  return rows.length > 0;
}

/**
 * §8.2 (C3): a device the view does not know yet is admitted when its entry is the book's first (its creator's seed),
 * or carries invite terms an owner device of this book signed, introducing a member the terms allow, and no other device
 * used the invite. On admission the device enters the view. Returns why not, or null.
 */
export async function introductionRefusal(tx: Db, bookId: string, author: string, seq: number, changeSet: ChangeSet): Promise<string | null> {
  const refuse = (why: string) => `AUTHORITY: introduction ${why}`;
  const intro = changeSet.ops.find((op) => op.entity === 'device' && op.id === author && op.op === 'upsert');
  const memberId = intro && intro.op === 'upsert' ? (intro.fields.memberId as string | undefined) : undefined;
  if (!memberId) return refuse('names no member');
  if (seq !== 1) {
    const terms = changeSet.invite;
    if (!terms) return refuse('without an owner’s invite');
    const owners = await viewOwnerDevices(tx, bookId);
    const bytes = termsSigningBytes(bookId, terms);
    let signed = false;
    for (const owner of owners) {
      const [row] = await tx.values<[string]>(sql`SELECT sign_jwk FROM book_devices WHERE book_id = ${bookId} AND device_id = ${owner}`);
      if (row && (await verifySignature(JSON.parse(row[0]) as JsonWebKey, bytes, terms.sig))) signed = true;
    }
    if (!signed) return refuse('whose invite no owner signed');
    if (terms.sameMember) {
      if (memberId !== terms.memberId) return refuse('as a member the invite does not name');
    } else if (await viewMember(tx, bookId, memberId)) {
      return refuse('as a member who already exists');
    }
    const used = await tx.values(sql`SELECT 1 FROM sync_invites_used WHERE book_id = ${bookId} AND invite_id = ${terms.inviteId}`);
    if (used.length > 0) return refuse('on an invite another device already used');
    await tx.run(sql`INSERT INTO sync_invites_used (book_id, invite_id, device_id) VALUES (${bookId}, ${terms.inviteId}, ${author})`);
  }
  await tx.run(sql`INSERT INTO sync_authority_devices (book_id, device_id, member_id, removed_seq, added_seq) VALUES (${bookId}, ${author}, ${memberId}, NULL, ${seq})`);
  return null;
}

const DEVICE_FIXED = ['signJwk', 'agreeJwk', 'memberId', 'addedAt'];

function without(op: Extract<Op, { op: 'upsert' }>, drop: readonly string[]): Extract<Op, { op: 'upsert' }> {
  const fields = Object.fromEntries(Object.entries(op.fields).filter(([f]) => !drop.includes(f)));
  const out: Extract<Op, { op: 'upsert' }> = { ...op, fields };
  if (op.changed) out.changed = op.changed.filter((f) => !drop.includes(f));
  if (op.clocks) out.clocks = Object.fromEntries(Object.entries(op.clocks).filter(([f]) => !drop.includes(f)));
  return out;
}

export interface DecideContext {
  bookId: string;
  author: string;
  hlc: string;
  /** The book's first entry: its creator's seed. */
  creator: boolean;
  /** The member an admitted introduction joins as. */
  introducedMember?: string;
  /**
   * This entry is this device's own (task 1 re-review round 1 ruling): a writer-only row's op is decided at capture
   * time instead (`withCapture`, against the pre-image), never here against the live row, which already holds the
   * author's own write. `decideRowWriter` is skipped for an own entry; every other decision here runs alike.
   */
  own?: boolean;
}

/**
 * Decides every op of one entry, in order, against the view — and moves the view along with each member op it
 * accepts, so a later op of the same entry sees it. Returns, per op, the op as it may be applied or its refusal.
 */
export async function decideOpsTx(tx: Db, ctx: DecideContext, ops: readonly Op[]): Promise<(Op | AuthorityError)[]> {
  const out: (Op | AuthorityError)[] = [];
  for (const op of ops) {
    try {
      out.push(await decideOp(tx, ctx, op));
    } catch (error) {
      if (error instanceof AuthorityError) out.push(error);
      else throw error;
    }
  }
  return out;
}

async function decideOp(tx: Db, ctx: DecideContext, op: Op): Promise<Op> {
  const { bookId, author } = ctx;
  if (op.entity === 'device') {
    // C1: a device row is written by its own device only; its keys never change after its introduction; `removedAt`
    // comes from removal entries alone.
    if (op.id !== author) throw new AuthorityError('a device row is written by its own device only');
    if (op.op === 'delete') throw new AuthorityError('a device row is never deleted by an op');
    const exists = (await tx.values(sql`SELECT 1 FROM book_devices WHERE book_id = ${bookId} AND device_id = ${op.id}`)).length > 0;
    if (exists) return without(op, [...DEVICE_FIXED, 'removedAt']);
    const signJwk = typeof op.fields.signJwk === 'string' ? (JSON.parse(op.fields.signJwk) as JsonWebKey) : (op.fields.signJwk as JsonWebKey | undefined);
    if (!signJwk || (await deviceIdOf({ signJwk }).catch(() => null)) !== op.id) throw new AuthorityError('a device is introduced with its own key');
    const inserted = without(op, ['removedAt']);
    inserted.fields.removedAt = null;
    if (!op.changed) inserted.changed = Object.keys(inserted.fields).filter((f) => f !== 'removedAt');
    return inserted;
  }
  if (op.entity === 'member') return decideMember(tx, ctx, op);
  const entity = entityOf(op.entity);
  if (entity.kind === 'row' && entity.writer && !ctx.own) return decideRowWriter(tx, bookId, author, entity, op);
  return op;
}

/** The member a JSON-encoded `{ owner }` field (a `member_transfer`'s `from`/`to`) names, or undefined — never throws
 * on malformed peer data (task 1 review round 1, finding 4). */
function ownerOf(value: unknown): string | undefined {
  try {
    const parsed = typeof value === 'string' ? (JSON.parse(value) as { owner?: unknown }) : (value as { owner?: unknown } | undefined);
    return typeof parsed?.owner === 'string' ? parsed.owner : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `member` is a party of a `member_transfer`'s `from`/`to` fields (its `writer` reads `'either-party'`). */
function isParty(fields: Record<string, unknown>, member: string | null): boolean {
  return member !== null && (ownerOf(fields.from) === member || ownerOf(fields.to) === member);
}

/**
 * Whether `member` may write a row of `entity` whose `writer`-relevant fields read as `fields` (spec §5.1): the one
 * predicate both the peer-side decision below (judging the stored row) and the local capture-time guard
 * (`withCapture`, judging the pre-image, task 1 re-review round 1 ruling) call, so the two never diverge. `null` —
 * an entity with no `writer` restriction — always allows; an undeterminable writer (an absent field) never does.
 */
export function isWriter(entity: RowEntity, fields: Record<string, unknown>, key: Record<string, string>, member: string | null): boolean {
  if (!entity.writer) return true;
  const writer = entity.writer(fields, key);
  if (writer === null) return false;
  return writer === 'either-party' ? isParty(fields, member) : writer === member;
}

/**
 * Once a writer-only row exists, the field(s) its `writer` is read from may never change — not even by its rightful
 * writer — so nobody can grant themselves (or anyone else) a row already made (task 1 review round 1, finding 2).
 */
const WRITER_FROZEN_FIELDS: Readonly<Record<string, readonly string[]>> = {
  nw_proposal: ['proposedBy'],
  nw_item: ['owner'],
  member_transfer: ['from', 'to', 'recordedBy'],
};

/** Whether an edit from `before` to `after` (full field-value snapshots) moves one of `entity`'s frozen fields. */
export function frozenFieldChanged(entity: RowEntity, before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return (WRITER_FROZEN_FIELDS[entity.entity] ?? []).some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

/** A row entity's stored fields (by field name, `entity.fields`' keys), or null when it is not here. */
async function storedRowOf(tx: Db, entity: RowEntity, bookId: string, key: Record<string, string>): Promise<Record<string, unknown> | null> {
  const columns = Object.entries(entity.fields);
  if (columns.length === 0) return {};
  const where = sql.join(
    [sql`book_id = ${bookId}`, ...entity.keyColumns.map((c) => sql`${sql.raw(c)} = ${key[c]}`)],
    sql` AND `,
  );
  const [row] = await tx.values<unknown[]>(sql`SELECT ${sql.raw(columns.map(([, c]) => c).join(', '))} FROM ${sql.raw(entity.table)} WHERE ${where}`);
  return row ? Object.fromEntries(columns.map(([f], i) => [f, row[i]])) : null;
}

/**
 * Joint-net-worth spec §5.1 (task 1 review round 1, findings 1–4). Only for a **peer's** entry (task 1 re-review
 * round 1 ruling): the local capture-time guard (`withCapture`) already enforced this rule locally, against the
 * pre-image, before the write ever committed — judging it again here, against the *live* local row, would read the
 * device's own just-applied write as "already true" and either wrongly allow a takeover (the live row now matches
 * the taker) or wrongly refuse a legitimate delete (the row is already gone) — so `decideOp` never calls this for a
 * device's own entries.
 *
 * The member `entity.writer` names is resolved from the **authority view**'s device→member binding
 * (`authorMemberOf`), never a change-set's own claimed `member` (finding 1). A row that already exists is judged by
 * its STORED writer, not the incoming op's (finding 2: an op cannot grant itself a row by rewriting who owns it) —
 * and, once it exists, its writer-bearing field(s) may never change, by anyone (`frozenFieldChanged`). A new row is
 * judged by the op's own fields. A writer that cannot be determined (an absent field, or a delete of a row not
 * here) is refused, not allowed (finding 3).
 */
async function decideRowWriter(tx: Db, bookId: string, author: string, entity: RowEntity, op: Op): Promise<Op> {
  const key = parseOpId(entity, op.id);
  const stored = await storedRowOf(tx, entity, bookId, key);
  const authorMember = await authorMemberOf(tx, bookId, author);
  const REFUSED = new AuthorityError('writer');
  if (op.op === 'delete') {
    if (stored === null || !isWriter(entity, stored, key, authorMember)) throw REFUSED; // finding 3
    return op;
  }
  if (stored === null) {
    // A new row: judged by the op's own fields (finding 2).
    if (!isWriter(entity, op.fields, key, authorMember)) throw REFUSED;
    return op;
  }
  // An existing row: judged by what is already here, and its writer-bearing field(s) may not move (finding 2).
  if (!isWriter(entity, stored, key, authorMember)) throw REFUSED;
  for (const field of WRITER_FROZEN_FIELDS[entity.entity] ?? []) {
    if (field in op.fields && String(op.fields[field]) !== String(stored[field])) throw REFUSED;
  }
  return op;
}

/** §8.5 (C3, N1): member rows — role, delete and making again are an owner's; the last owner stays an owner. */
async function decideMember(tx: Db, ctx: DecideContext, op: Op): Promise<Op> {
  const { bookId, hlc } = ctx;
  const view = await viewMember(tx, bookId, op.id);
  const owner = ctx.creator || (await viewRoleOfDevice(tx, bookId, ctx.author)) === 'owner';
  const lastOwner = await viewIsLastOwner(tx, bookId, op.id);

  if (op.op === 'delete') {
    if (!owner) throw new AuthorityError('only an owner deletes a member');
    if (lastOwner && hlc > view!.rowHlc) throw new AuthorityError('the last owner cannot be deleted');
    if (view && hlc > view.rowHlc) await tx.run(sql`UPDATE sync_authority SET deleted = 1, row_hlc = ${hlc} WHERE book_id = ${bookId} AND member_id = ${op.id}`);
    return op;
  }

  const named = op.changed ?? Object.keys(op.fields);
  const ownIntroduction = view === null && ctx.introducedMember === op.id;
  // Making a member row (new, or again after a delete) is an owner's; so is bringing a deleted one back by any edit.
  // A non-owner's edit that crossed a delete stays dead instead (NO_REVIVE), so nobody's row comes back by it.
  const creates = view === null || (view.deleted && hlc > view.rowHlc && makesMember(op));
  if (creates && !owner && !ownIntroduction) throw new AuthorityError('only an owner makes a member');
  const remakes = view === null || (view.deleted && hlc > view.rowHlc && (owner || ownIntroduction));
  let decided: Extract<Op, { op: 'upsert' }> = op;
  if (named.includes('role') && 'role' in op.fields) {
    if (!owner && !(ownIntroduction && op.fields.role === 'member')) throw new AuthorityError('only an owner writes a role');
    if (lastOwner && op.fields.role !== 'owner' && hlc > view!.roleHlc) throw new AuthorityError('the last owner cannot be made a member');
  } else if (!owner && 'role' in op.fields) {
    // A role a non-owner's op merely carries (a whole revivable row) cannot win: its clock goes, and it inserts only
    // as 'member'.
    decided = without(op, []);
    if (decided.clocks) delete decided.clocks.role;
    decided.fields.role = 'member';
  }

  if (!owner && !ownIntroduction) {
    if (decided === op) decided = without(op, []);
    NO_REVIVE.add(decided);
  }

  // Move the view along.
  const role = typeof decided.fields.role === 'string' ? decided.fields.role : 'member';
  if (view === null) {
    await tx.run(sql`INSERT INTO sync_authority (book_id, member_id, role, role_hlc, deleted, row_hlc) VALUES (${bookId}, ${op.id}, ${role}, ${hlc}, 0, ${hlc})`);
  } else {
    if (remakes) await tx.run(sql`UPDATE sync_authority SET deleted = 0, row_hlc = ${hlc} WHERE book_id = ${bookId} AND member_id = ${op.id}`);
    if (named.includes('role') && 'role' in decided.fields && hlc > view.roleHlc) {
      await tx.run(sql`UPDATE sync_authority SET role = ${role}, role_hlc = ${hlc} WHERE book_id = ${bookId} AND member_id = ${op.id}`);
    }
  }
  return decided;
}
