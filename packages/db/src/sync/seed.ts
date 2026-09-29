import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../database';
import { AuthorityError, viewRoleOfDevice } from './authority';
import { isRevivable, lineageOfTransaction, localDeviceId, projectPurchase, rowUpsertsTx, writeChangeSetsTx, type CaptureConfig, type SharedBook } from './capture';
import { localTick } from './hlc';
import { entityOf } from './shared-entities';
import type { ChangeSet, DevicePublic, Op } from './types';

/*
 * Seeding (household-sharing spec §6.5 steps 0–3): sharing a workspace that already has history. Every row in scope
 * goes into the outbox as a full upsert, in an order a receiver can apply straight through — the book, its members and
 * devices, categories parents first, then what hangs off them, then every non-void purchase oldest first — cut into
 * change-sets with their field clocks written. Step 4 (draining, and the invite after it) is the caller's.
 *
 * A book shared before (recovery review, N2) keeps its field clocks through the time its sharing was down
 * (`sync_kept_clocks`, `keepClocksTx`), and sharing it again or rejoining sends each field at its own clock — fresh only
 * where it changed while nothing was captured (`catchUpTx`) — so last-writer-wins decides every field alike on every
 * device, whoever wrote it last. After a rejoin's pull, whatever this device holds that is newer than the log goes out
 * (`emitNewerTx`).
 */

export type SharingErrorCode =
  | 'CURRENCY'
  | 'ALREADY_SHARED'
  | 'NOT_FOUND'
  | 'BAD_CODE'
  | 'INVITE_CLAIMED'
  | 'INVITE_EXPIRED'
  | 'INVITE_MISMATCH'
  | 'NO_KEYS'
  | 'NOT_OWNER'
  | 'FROZEN'
  | 'LEAVE_INCOMPLETE'
  | 'STILL_SHARED'
  | 'INVITER_NOT_OWNER'
  // Joint net worth's group log (task 4): the workspace already has a net-worth group this device is not in; a member
  // still in the group (never answered 'left', a device still in the workspace) is not removed by another.
  | 'GROUP_EXISTS'
  | 'NOT_LEFT';

/** The settings key under which a device remembers its own member in a book it stopped sharing or kept as its own (§8.6, final review C1). */
export const REMEMBERED_MEMBER_KEY = (bookId: string) => `sharing.member.${bookId}`;

export class SharingError extends Error {
  constructor(
    readonly code: SharingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SharingError';
  }
}

export interface SeedInput {
  bookId: string;
  relayBookId: string;
  memberId: string;
  memberName: string;
  deviceId: string;
  deviceName: string;
  device: DevicePublic;
  /** This app's own version (joint-net-worth spec §9), written on the seeded `book_devices` row's `app_version`. */
  appVersion?: string;
}

/** §6.5 step 0 (ruled O3): the book must keep its money in the owner's own currency. Refuses before anything is made. */
export async function assertShareableTx(tx: Tx, bookId: string): Promise<void> {
  const [row] = await tx.values<[string, string]>(
    sql`SELECT b.base_currency, w.base_currency FROM books b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = ${bookId}`,
  );
  if (!row) throw new SharingError('NOT_FOUND', 'That workspace is not here');
  const [bookCurrency, ownCurrency] = row;
  if (bookCurrency !== ownCurrency) {
    throw new SharingError(
      'CURRENCY',
      `This workspace keeps its money in ${bookCurrency}; this app keeps yours in ${ownCurrency}. Sharing across currencies isn't supported yet.`,
    );
  }
  if ((await tx.values(sql`SELECT 1 FROM shared_books WHERE book_id = ${bookId}`)).length > 0) {
    throw new SharingError('ALREADY_SHARED', 'This workspace is already shared');
  }
}

/** Categories parents first, so a receiver never meets a child before its parent. */
function parentsFirst(ops: Op[]): Op[] {
  const byId = new Map(ops.map((op) => [op.id, op]));
  const depth = (op: Op, seen = new Set<string>()): number => {
    const parentId = op.op === 'upsert' ? (op.fields.parentId as string | null) : null;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent || seen.has(op.id)) return 0;
    seen.add(op.id);
    return 1 + depth(parent, seen);
  };
  return ops.map((op, i) => ({ op, i, d: depth(op) })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.op);
}

/**
 * §6.5 steps 1–3 inside the caller's transaction: `shared_books` (epoch 1), this member and this device, then every row
 * in scope, sealed into the outbox. The relay book (step 1) is made by the caller first. Returns how many change-sets
 * wait to be drained.
 *
 * A book shared before (N2) goes out at the clocks it kept (`catchUpTx`): each field at its own, a field changed since
 * at a fresh one, a field with none at the seed's. A purchase void here goes out as a void, and a row deleted while
 * nothing was captured as a delete, so a member's copy that rejoins ends as this one does.
 */
export async function seedBookTx(tx: Tx, config: Pick<CaptureConfig, 'now'>, input: SeedInput): Promise<number> {
  await assertShareableTx(tx, input.bookId);
  const now = new Date().toISOString();
  await tx.run(
    sql`INSERT INTO shared_books (book_id, relay_book_id, epoch, member_id, state, shared_at) VALUES (${input.bookId}, ${input.relayBookId}, 1, ${input.memberId}, 'active', ${now})`,
  );
  // A book shared before and stopped (§8.6) still has its members here: the sharer is its owner again, and whoever else
  // it remembers comes back as a member, never an owner with no device.
  await tx.run(sql`UPDATE book_members SET role = 'member' WHERE book_id = ${input.bookId} AND member_id <> ${input.memberId}`);
  await tx.run(sql`
    INSERT INTO book_members (book_id, member_id, name, role, joined_at) VALUES (${input.bookId}, ${input.memberId}, ${input.memberName}, 'owner', ${now})
    ON CONFLICT (book_id, member_id) DO UPDATE SET name = excluded.name, role = 'owner'`);
  await tx.run(sql`
    INSERT INTO book_devices (book_id, device_id, member_id, name, sign_jwk, agree_jwk, added_at, removed_at, app_version)
    VALUES (${input.bookId}, ${input.deviceId}, ${input.memberId}, ${input.deviceName}, ${JSON.stringify(input.device.signJwk)}, ${JSON.stringify(input.device.agreeJwk)}, ${now}, NULL, ${input.appVersion ?? null})`);

  const book: SharedBook = { bookId: input.bookId, memberId: input.memberId, epoch: 1 };
  const { deletes } = await catchUpTx(tx, book, config.now?.());
  const clocks = await clocksOfBook(tx, book.bookId);
  const ops = (await rowsInScopeTx(tx, book, () => true)).map((op) => atOwnClocks(op, clocks));
  for (const lineageId of await voidLineagesOf(tx, book.bookId)) ops.push(atOwnClocks({ entity: 'purchase', id: lineageId, op: 'upsert', fields: { void: true } }, clocks));
  return writeChangeSetsTx(tx, config, book, [...ops, ...deletes]);
}

interface RowsOptions {
  /** Give a posted purchase with no `sync_lineage` row one (seeding, emitting). Off for a snapshot, which writes nothing. */
  record?: boolean;
  /** This device's own `device` row (seeding). */
  device?: boolean;
}

/**
 * Every row of the book in scope as a full upsert, in the order a receiver applies straight through (§6.5 step 2),
 * keeping only those `keep` accepts. A non-void purchase is emitted as paid by this member; one with no `sync_lineage`
 * row yet gets one.
 */
export async function rowsInScopeTx(tx: Tx, book: SharedBook, keep: (entity: string, id: string) => boolean, options: RowsOptions = {}): Promise<Op[]> {
  const { record = true, device = true } = options;
  const ops: Op[] = [];
  const rows = async (entity: string) => (await rowUpsertsTx(tx, book, entity)).filter((op) => keep(op.entity, op.id));
  ops.push(...(await rows('book')), ...(await rows('member')));
  // A device row is written by its own device only (§5.4, task 5 fix round 1): only this device's goes out.
  if (device) {
    const self = await localDeviceId(tx);
    ops.push(...(await rows('device')).filter((op) => op.id === self));
  }
  ops.push(...parentsFirst(await rows('category')), ...(await rows('category_need')));
  ops.push(...(await rows('budget')), ...(await rows('budget_frequency')), ...(await rows('budget_override')));
  ops.push(...(await rows('book_income')), ...(await rows('book_income_override')));
  ops.push(...(await rows('bill')), ...(await rows('bill_window')), ...(await rows('bill_skip')));

  // Every non-void purchase, oldest first. A void one never existed for the other member.
  const heads = await tx.values<[string]>(sql`
    SELECT t.id FROM transactions t JOIN book_transactions bt ON bt.transaction_id = t.id
    WHERE bt.book_id = ${book.bookId} AND t.status = 'posted'
    ORDER BY t.occurred_on, t.created_at, t.rowid`);
  for (const [head] of heads) {
    const lineageId = await lineageOfTransaction(tx, head);
    if (!keep('purchase', lineageId)) continue;
    const [known] = await tx.values<[string, string]>(sql`SELECT paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${lineageId}`);
    if (!known && !record) continue;
    const purchase = (await projectPurchase(tx, head, book.memberId, known ? { paidBy: known[0], paidLabel: known[1] } : null))!;
    if (!known) {
      purchase.money.paidBy = book.memberId;
      await tx.run(
        sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${lineageId}, ${book.bookId}, ${head}, ${book.memberId}, ${purchase.money.paidLabel})`,
      );
    }
    ops.push({ entity: 'purchase', id: lineageId, op: 'upsert', fields: { ...purchase } });
  }
  return ops;
}

/* ------------------------------------------------ clocks kept while a share is down (N2) */

const rowKey = (entity: string, id: string) => `${entity}\u0000${id}`;
const fieldKey = (entity: string, id: string, field: string) => `${entity}\u0000${id}\u0000${field}`;

/** Every field clock of the book, by entity, id and field. */
async function clocksOfBook(tx: Db, bookId: string): Promise<Map<string, string>> {
  const rows = await tx.values<[string, string, string, string]>(sql`SELECT entity, id, field, hlc FROM sync_field_clocks WHERE book_id = ${bookId}`);
  return new Map(rows.map(([entity, id, field, hlc]) => [fieldKey(entity, id, field), hlc]));
}

async function voidLineagesOf(tx: Db, bookId: string): Promise<string[]> {
  return (await tx.values<[string]>(sql`SELECT lineage_id FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NULL ORDER BY lineage_id`)).map(([id]) => id);
}

/** An upsert with every field that has a clock here sent at that clock (`clocks`), and the rest at the change-set's. */
function atOwnClocks(op: Op, clocks: ReadonlyMap<string, string>, only?: readonly string[]): Op {
  if (op.op !== 'upsert') return op;
  const at: Record<string, string> = {};
  for (const field of only ?? Object.keys(op.fields)) {
    const hlc = clocks.get(fieldKey(op.entity, op.id, field));
    if (hlc !== undefined) at[field] = hlc;
  }
  if (only) return { ...op, changed: [], clocks: at };
  if (Object.keys(at).length === 0) return op;
  return { ...op, changed: Object.keys(op.fields).filter((f) => !(f in at)), clocks: at };
}

async function setClockTx(tx: Db, bookId: string, entity: string, id: string, field: string, hlc: string): Promise<void> {
  await tx.run(
    sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${bookId}, ${entity}, ${id}, ${field}, ${hlc}) ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = excluded.hlc`,
  );
}

/**
 * The moment this device stops keeping a book's clocks (N2): the book goes `needs_invite` (nothing is captured while it
 * waits), or its sync state is dropped (stop sharing, keep as my own copy). Every field that has a clock is kept with
 * its value then, once — a later drop keeps what the first kept, since what changed in between has no clock. Nothing
 * else is written.
 */
export async function keepClocksTx(tx: Tx, bookId: string): Promise<void> {
  if ((await tx.values(sql`SELECT 1 FROM sync_kept_clocks WHERE book_id = ${bookId} LIMIT 1`)).length > 0) return;
  const [shared] = await tx.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${bookId}`);
  if (!shared) return;
  const clocks = await clocksOfBook(tx, bookId);
  if (clocks.size === 0) return;
  const keep = async (entity: string, id: string, field: string, value: unknown) => {
    const hlc = clocks.get(fieldKey(entity, id, field));
    if (hlc === undefined) return;
    await tx.run(
      sql`INSERT INTO sync_kept_clocks (book_id, entity, id, field, hlc, value_json) VALUES (${bookId}, ${entity}, ${id}, ${field}, ${hlc}, ${JSON.stringify(value)}) ON CONFLICT DO NOTHING`,
    );
  };
  for (const op of await rowsInScopeTx(tx, { bookId, memberId: shared[0], epoch: 0 }, () => true, { record: false, device: false })) {
    if (op.op !== 'upsert') continue;
    for (const [field, value] of Object.entries(op.fields)) await keep(op.entity, op.id, field, value);
  }
  for (const lineageId of await voidLineagesOf(tx, bookId)) await keep('purchase', lineageId, 'void', true);
}

/** The posted row a lineage reads as now: its recorded head, else the latest posted row replacing it, in the book. */
async function postedHeadTx(tx: Db, bookId: string, head: string): Promise<string | null> {
  const [row] = await tx.values<[string]>(sql`
    WITH RECURSIVE forward(id, depth) AS (
      SELECT ${head}, 0
      UNION ALL
      SELECT t.id, f.depth + 1 FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id
    )
    SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
    WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})
    ORDER BY f.depth DESC LIMIT 1`);
  return row?.[0] ?? null;
}

/**
 * Before a book is shared again or rejoins (N2): brings this device's sync state up to what its rows say now, after a
 * time nothing was captured (`needs_invite`, a stopped share, a copy kept as its own).
 *
 * - A purchase voided or re-filed out of the book meanwhile is void here (`head` null, a fresh `void` clock); one
 *   corrected meanwhile gets its new head.
 * - Every field kept by `keepClocksTx` gets its kept clock back when its value is unchanged, and a fresh clock when it
 *   changed: a local edit made while nothing was captured is newer than anything the log holds from before it.
 * - A kept row gone now was deleted meanwhile: a tombstone at a fresh clock here, and a delete op returned for the
 *   caller to send (the seed does; a rejoin's `emitNewerTx` finds the tombstone).
 *
 * Then the kept clocks go. A book with none (never shared, or unshared and read-only since) only gets the purchase check.
 */
export async function catchUpTx(tx: Tx, book: SharedBook, now?: number): Promise<{ deletes: Op[] }> {
  const { bookId } = book;
  let hlc: string | undefined;
  const fresh = async () => (hlc ??= await localTick(tx, await localDeviceId(tx), now ?? Date.now()));

  const lineages = await tx.values<[string, string, string, string]>(
    sql`SELECT lineage_id, head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE book_id = ${bookId} AND head_transaction_id IS NOT NULL`,
  );
  for (const [lineageId, head, paidBy, paidLabel] of lineages) {
    const posted = await postedHeadTx(tx, bookId, head);
    if (posted === head) continue;
    if (posted === null) {
      await tx.run(sql`UPDATE sync_lineage SET head_transaction_id = NULL WHERE lineage_id = ${lineageId}`);
      await setClockTx(tx, bookId, 'purchase', lineageId, 'void', await fresh());
      continue;
    }
    const reads = (await projectPurchase(tx, posted, book.memberId, { paidBy, paidLabel }))!;
    await tx.run(sql`UPDATE sync_lineage SET head_transaction_id = ${posted}, paid_by = ${reads.money.paidBy}, paid_label = ${reads.money.paidLabel} WHERE lineage_id = ${lineageId}`);
  }

  const keptRows = await tx.values<[string, string, string, string, string]>(sql`SELECT entity, id, field, hlc, value_json FROM sync_kept_clocks WHERE book_id = ${bookId}`);
  if (keptRows.length === 0) return { deletes: [] };
  const kept = new Map<string, { entity: string; id: string; fields: Map<string, { hlc: string; value: string }> }>();
  for (const [entity, id, field, at, value] of keptRows) {
    const key = rowKey(entity, id);
    const row = kept.get(key) ?? { entity, id, fields: new Map() };
    row.fields.set(field, { hlc: at, value });
    kept.set(key, row);
  }
  const alive = new Set<string>();
  for (const op of await rowsInScopeTx(tx, book, () => true, { device: false })) {
    if (op.op !== 'upsert') continue;
    const key = rowKey(op.entity, op.id);
    alive.add(key);
    const row = kept.get(key);
    if (!row) continue;
    for (const [field, value] of Object.entries(op.fields)) {
      const was = row.fields.get(field);
      if (was) await setClockTx(tx, bookId, op.entity, op.id, field, JSON.stringify(value) === was.value ? was.hlc : await fresh());
    }
  }
  for (const lineageId of await voidLineagesOf(tx, bookId)) {
    alive.add(rowKey('purchase', lineageId));
    const was = kept.get(rowKey('purchase', lineageId))?.fields.get('void');
    const [has] = await tx.values(sql`SELECT 1 FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = 'purchase' AND id = ${lineageId} AND field = 'void'`);
    if (was && !has) await setClockTx(tx, bookId, 'purchase', lineageId, 'void', was.hlc);
  }
  const deletes: Op[] = [];
  for (const [key, row] of kept) {
    if (alive.has(key) || row.entity === 'purchase' || row.entity === 'device') continue;
    const entity = entityOf(row.entity);
    const values = entity.kind === 'row' && isRevivable(entity) ? Object.fromEntries([...row.fields].map(([f, v]) => [f, JSON.parse(v.value) as unknown])) : null;
    await tx.run(
      sql`INSERT INTO sync_tombstones (book_id, entity, id, hlc, last_json) VALUES (${bookId}, ${row.entity}, ${row.id}, ${await fresh()}, ${values ? JSON.stringify(values) : null}) ON CONFLICT (book_id, entity, id) DO UPDATE SET hlc = excluded.hlc`,
    );
    deletes.push({ entity: row.entity, id: row.id, op: 'delete' });
  }
  await tx.run(sql`DELETE FROM sync_kept_clocks WHERE book_id = ${bookId}`);
  return { deletes };
}

/* ------------------------------------------------------------ the rejoin's emit (§8.7, N2) */

/**
 * What a rejoin's pull saw of the log, op by op, the ops the authority view refused left out: which rows it names, the
 * clock each field of each row reached in it, and whether its last word on a row was an upsert.
 */
export class SeenLog {
  readonly rows = new Set<string>();
  private readonly fields = new Map<string, string>();
  private readonly alive = new Map<string, boolean>();

  note(changeSet: ChangeSet, decisions: readonly (Op | AuthorityError)[]): void {
    changeSet.ops.forEach((op, i) => {
      if (decisions[i] instanceof AuthorityError) return;
      const key = rowKey(op.entity, op.id);
      this.rows.add(key);
      this.alive.set(key, op.op === 'upsert');
      if (op.op !== 'upsert') return;
      const at = (field: string, hlc: string) => {
        const k = fieldKey(op.entity, op.id, field);
        const was = this.fields.get(k);
        if (was === undefined || hlc > was) this.fields.set(k, hlc);
      };
      for (const field of op.changed ?? Object.keys(op.fields)) at(field, changeSet.hlc);
      for (const [field, hlc] of Object.entries(op.clocks ?? {})) at(field, hlc > changeSet.hlc ? changeSet.hlc : hlc); // as apply takes it (NEW-1)
    });
  }

  /** The latest clock the log gave this field, or undefined. */
  clockOf(entity: string, id: string, field: string): string | undefined {
    return this.fields.get(fieldKey(entity, id, field));
  }

  /** The log's last word on the row was an upsert. */
  aliveInLog(entity: string, id: string): boolean {
    return this.alive.get(rowKey(entity, id)) === true;
  }
}

/**
 * §8.7's rejoin, after the pull from 0 (N2): whatever this device holds that the new log does not already say goes
 * out, each field at its own clock, so last-writer-wins decides it on every device alike. Returns how many change-sets
 * it wrote.
 *
 * - A row in scope the log never names goes out whole (made before a backup, or while the share was down).
 * - A field whose clock here is newer than the log's for it goes out at that clock: an edit made on the orphaned relay
 *   book after the owner's backup, or one the lost phone made there that its backup never had.
 * - A void here that the log has not got (its clock newer than the log's `void`), for a purchase the log names or not.
 * - A row deleted here that the log still has alive: a delete.
 *
 * Only what the author may write goes out (§8.5): no device row (its introduction went with the join), and no role, no
 * new member row and no member delete unless this device's member is an owner in the view.
 */
export async function emitNewerTx(tx: Tx, config: Pick<CaptureConfig, 'now'>, book: SharedBook, seen: SeenLog): Promise<number> {
  const { bookId } = book;
  const owner = (await viewRoleOfDevice(tx, bookId, await localDeviceId(tx))) === 'owner';
  const clocks = await clocksOfBook(tx, bookId);
  const ops: Op[] = [];
  for (const op of await rowsInScopeTx(tx, book, () => true, { device: false })) {
    if (op.op !== 'upsert') continue;
    const member = op.entity === 'member';
    if (!seen.rows.has(rowKey(op.entity, op.id))) {
      if (!member || owner) ops.push(atOwnClocks(op, clocks));
      continue;
    }
    const newer = Object.keys(op.fields).filter((field) => {
      if (member && field === 'role' && !owner) return false;
      const here = clocks.get(fieldKey(op.entity, op.id, field));
      const there = seen.clockOf(op.entity, op.id, field);
      return here !== undefined && (there === undefined || here > there);
    });
    if (newer.length === 0) continue;
    const whole = op.entity === 'purchase' ? { ...op, fields: Object.fromEntries(newer.map((f) => [f, op.fields[f]])) } : op;
    ops.push(atOwnClocks(whole, clocks, newer));
  }
  for (const lineageId of await voidLineagesOf(tx, bookId)) {
    const here = clocks.get(fieldKey('purchase', lineageId, 'void'));
    const there = seen.clockOf('purchase', lineageId, 'void');
    if (here !== undefined && (there === undefined || here > there)) ops.push(atOwnClocks({ entity: 'purchase', id: lineageId, op: 'upsert', fields: { void: true } }, clocks, ['void']));
  }
  const tombstones = await tx.values<[string, string]>(sql`SELECT entity, id FROM sync_tombstones WHERE book_id = ${bookId} ORDER BY hlc`);
  for (const [entity, id] of tombstones) {
    if (entity === 'device' || (entity === 'member' && !owner)) continue;
    if (seen.aliveInLog(entity, id)) ops.push({ entity, id, op: 'delete' });
  }
  return writeChangeSetsTx(tx, config, book, ops);
}
