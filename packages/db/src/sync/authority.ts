import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { termsSigningBytes } from './invite';
import { deviceIdOf, verifySignature } from './relay-signing';
import type { ChangeSet, Op } from './types';

/*
 * Who may write what (spec §5.4, §8.2, §8.4, §8.5; task 5 fix round 1). Everything here is decided from the log and
 * the rows the log already made, so every device reaches the same answer, and a refusal is a recorded skip on all of
 * them alike (§7.1) — never applied, never a reason to rotate.
 *
 * - A device row is its own device's: only its author writes it; its keys are fixed by its introduction and its
 *   `removedAt` only by a removal entry (C1).
 * - A removal of another device needs an owner (C2).
 * - An introduction after the book's first entry carries an owner's signed invite terms, joins as a new member or as the
 *   member they name, once per invite (C3).
 * - Only an owner writes a role; a new member introduces itself as `'member'` (C3, §8.5).
 */

/** Why an op or entry is refused; the text goes into `sync_skipped.error`. */
export class AuthorityError extends Error {
  constructor(message: string) {
    super(`AUTHORITY: ${message}`);
    this.name = 'SkipOp';
  }
}

/** The role of the member a device belongs to in the book, as this device's rows say now. */
export async function roleOfDevice(tx: Db, bookId: string, deviceId: string): Promise<string | null> {
  const [row] = await tx.values<[string]>(sql`
    SELECT m.role FROM book_devices d JOIN book_members m ON m.book_id = d.book_id AND m.member_id = d.member_id
    WHERE d.book_id = ${bookId} AND d.device_id = ${deviceId}`);
  return row?.[0] ?? null;
}

/** §8.4 (C2): a removal counts when a device removes itself, or its author's member is an owner. */
export async function removalRefusal(tx: Db, bookId: string, author: string, target: string): Promise<string | null> {
  if (author === target) return null;
  if ((await roleOfDevice(tx, bookId, author)) === 'owner') return null;
  return 'AUTHORITY: only an owner removes another device';
}

/** I2: the author was removed at an hlc before this entry's — whatever it wrote after counts for nothing. */
export async function removedBefore(tx: Db, bookId: string, author: string, hlc: string): Promise<boolean> {
  // The removal's clock (applyRemovalTx stamps it), on a row a removal has marked.
  const [row] = await tx.values<[string]>(sql`
    SELECT c.hlc FROM sync_field_clocks c JOIN book_devices d ON d.book_id = c.book_id AND d.device_id = c.id
    WHERE c.book_id = ${bookId} AND c.entity = 'device' AND c.id = ${author} AND c.field = 'removedAt' AND d.removed_at IS NOT NULL`);
  return row !== undefined && hlc > row[0];
}

/** An earlier introduction of this device was refused: its later entries are skipped the same way, not a stop. */
export async function wasRefused(tx: Db, bookId: string, deviceId: string): Promise<boolean> {
  const rows = await tx.values(sql`SELECT 1 FROM sync_skipped WHERE book_id = ${bookId} AND entity = 'device' AND id = ${deviceId} AND error LIKE '%AUTHORITY: introduction%'`);
  return rows.length > 0;
}

/**
 * §8.2 (C3): an introduction is accepted when it is the book's first entry (its creator's seed) or carries invite terms
 * an owner device of this book signed, introducing a member the terms allow, and no other device used the invite.
 * Records the invite as used. Returns why not, or null.
 */
export async function introductionRefusal(tx: Db, bookId: string, author: string, seq: number, changeSet: ChangeSet): Promise<string | null> {
  if (seq === 1) return null;
  const refuse = (why: string) => `AUTHORITY: introduction ${why}`;
  const intro = changeSet.ops.find((op) => op.entity === 'device' && op.id === author && op.op === 'upsert');
  const memberId = intro && intro.op === 'upsert' ? (intro.fields.memberId as string | undefined) : undefined;
  const terms = changeSet.invite;
  if (!terms) return refuse('without an owner’s invite');
  if (!memberId) return refuse('names no member');
  const owners = await tx.values<[string]>(sql`
    SELECT d.sign_jwk FROM book_devices d JOIN book_members m ON m.book_id = d.book_id AND m.member_id = d.member_id
    WHERE d.book_id = ${bookId} AND d.removed_at IS NULL AND m.role = 'owner'`);
  const bytes = termsSigningBytes(bookId, terms);
  let signed = false;
  for (const [jwk] of owners) if (await verifySignature(JSON.parse(jwk) as JsonWebKey, bytes, terms.sig)) signed = true;
  if (!signed) return refuse('whose invite no owner signed');
  if (terms.sameMember) {
    if (memberId !== terms.memberId) return refuse('as a member the invite does not name');
  } else if ((await tx.values(sql`SELECT 1 FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`)).length > 0) {
    return refuse('as a member who already exists');
  }
  const used = await tx.values(sql`SELECT 1 FROM sync_invites_used WHERE book_id = ${bookId} AND invite_id = ${terms.inviteId}`);
  if (used.length > 0) return refuse('on an invite another device already used');
  await tx.run(sql`INSERT INTO sync_invites_used (book_id, invite_id, device_id) VALUES (${bookId}, ${terms.inviteId}, ${author})`);
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

/** What an entry's op may do, given who wrote it; the op as it may be applied, or an `AuthorityError`. */
export async function authorisedOp(tx: Db, bookId: string, op: Op, author: string, creator: boolean, introducedMember?: string): Promise<Op> {
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
  if (op.entity === 'member' && op.op === 'upsert' && 'role' in op.fields && !creator && (await roleOfDevice(tx, bookId, author)) !== 'owner') {
    // §8.5 (C3): only an owner writes a role. Decided from the op itself, so every device decides alike: a new member's
    // own introduction may name its role `'member'`; any other role a non-owner names is refused, and one it merely
    // carries (a whole revivable row) cannot win — its clock is dropped, and it can only ever insert as 'member'.
    const named = op.changed ?? Object.keys(op.fields);
    if (named.includes('role')) {
      if (!(introducedMember === op.id && op.fields.role === 'member')) throw new AuthorityError('only an owner writes a role');
      return op;
    }
    const out = without(op, []);
    if (out.clocks) delete out.clocks.role;
    out.fields.role = 'member';
    return out;
  }
  return op;
}
