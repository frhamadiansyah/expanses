import { uuidv7 } from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Database, Db, Tx } from '../database';
import { buildOpId, entityOf, parseOpId, SHARED_ENTITIES, type RowEntity } from './shared-entities';
import { makesMember, viewIsLastOwner, viewRoleOfDevice } from './authority';
import { reserveAndSplit } from './split';
import type { ChangeSet, Op } from './types';

/*
 * Capture (household-sharing spec §6.3): turning local writes to a shared book into ops, and ops into sealed
 * change-sets in `sync_outbox`, inside the very database transaction that made the writes — so a change-set is
 * durable exactly when its rows are (ruled O1).
 *
 * The outbox keeps each change-set as plaintext JSON; it is sealed and signed only when the engine drains it to the
 * relay (controller ruling, task 5; spec §6.3), under the book's epoch at that moment.
 *
 * `createDatabase().transaction` opens one `CaptureSession` per db transaction (the mutex serialises them, so there is
 * one current session per `Database`) and flushes it after the callback resolves and before `COMMIT`. Two kinds of
 * capture point feed it:
 *
 * - `withCapture(tx, target, fn)` around every in-place write of a row entity: snapshot the entity's synced fields
 *   before and after `fn`, and emit an upsert of the fields that differ, or a delete when the row left the book.
 * - `capturePostedTx` / `captureVoidingTx`, called by the ledger at its only two write sites (`postTransactionTx` and
 *   `markVoidTx`): they record which purchase lineages the transaction touched. At flush each lineage is resolved by
 *   its net effect, so a replace (void + post) is one correction and never a void (check #14).
 *
 * A write outside a shared book costs one lookup (the active `shared_books`, read once per transaction) and emits
 * nothing. Apply runs with capture switched off: `pauseCapture(tx)`.
 */

async function selfIsOwner(tx: Db, bookId: string): Promise<boolean> {
  return (await viewRoleOfDevice(tx, bookId, await localDeviceId(tx))) === 'owner';
}

/** A write that would leave a shared book with no owner (§8.5). */
export class LastOwnerError extends Error {
  constructor(message = "A shared workspace needs an owner: the last owner can't be removed or made a member") {
    super(message);
    this.name = 'LastOwnerError';
  }
}

/**
 * A write to a book that is no longer shared here (`shared_books.state = 'unshared'`, §8.6, task 9a): its owner stopped
 * sharing it, or this device left. The book stays with every row, read-only. Thrown from capture, inside the
 * transaction that tried, so the write is rolled back.
 */
export class BookReadOnlyError extends Error {
  constructor(readonly bookId: string) {
    super('This workspace is no longer shared, and is kept read-only');
    this.name = 'BookReadOnlyError';
  }
}

/**
 * A write into a shared book before this device's sync engine is ready (`prepare()` failed at open — a key store that
 * would not open, say; final review I3): refused rather than stamped with an id no key vouches for, and said in words a
 * person can act on (recovery review, minor), since it reaches whatever screen tried the write.
 */
export class SyncNotReadyError extends Error {
  constructor() {
    super("Sharing isn't ready on this device yet, so this shared workspace can't be changed. Close the app, open it again, and try once more.");
    this.name = 'SyncNotReadyError';
  }
}

/** The settings key of the stand-in device id used only while no `KeyStore` identity is configured (see `localDeviceId`). */
export const DEVICE_SETTINGS_KEY = 'sync.device';

export interface CaptureConfig {
  /** Off: no transaction on this database captures anything. */
  enabled: boolean;
  /**
   * This device's id from its `KeyStore` (spec §5.1). The sync engine sets it when it is made; every hlc and every
   * entry this database emits carries it.
   */
  deviceId?: string;
  /** The clock's wall time, for tests. */
  now?: () => number;
  /**
   * Tests only (final review, I3): let `localDeviceId` mint and keep a random stand-in id in `settings` when no engine
   * has configured one. The app never sets it: a write to a shared book before the engine exists is a bug, and throws.
   */
  standInDeviceId?: boolean;
  /**
   * Told when a transaction writes with capture deliberately off (`withCapturePaused`: apply writing what another
   * device already emitted). The §6.4 test harness uses it to leave those writes out of its watch, and only those.
   */
  pausedWrites?: {
    begin(tx: Db, changeSet?: ChangeSet): Promise<void>;
    end(tx: Db): Promise<void>;
    /** The ops apply actually took in, when they are known only after it ran (authority refusals left out). */
    applied?(tx: Db, changeSet: ChangeSet): Promise<void>;
  };
}

export function defaultCaptureConfig(): CaptureConfig {
  return { enabled: true };
}

const configs = new WeakMap<object, CaptureConfig>();

/** Called by `createDatabase` so `configureCapture(database, …)` reaches the config its transactions read. */
export function registerCaptureConfig(database: object, config: CaptureConfig): void {
  configs.set(database, config);
  const db = (database as { db?: object }).db;
  if (db) configs.set(db, config);
}

/** Switches capture on or off for a database, or sets the device id it stamps (the sync engine does, from the KeyStore). */
export function configureCapture(database: Database, patch: Partial<CaptureConfig>): void {
  const config = configs.get(database);
  if (!config) throw new Error('configureCapture: this database was not made by createDatabase');
  Object.assign(config, patch);
}

/**
 * This device's id for sync — the one seam. It is the `KeyStore`'s `deviceId` (spec §5.1), which the sync engine puts in
 * the capture config when it is made; the app makes the engine before its first write (`openAppDb`, §5.1). Only a
 * database no engine was ever made for, and that says so (`standInDeviceId`: a test of capture alone, the §6.4
 * harness), falls back to a random stand-in kept in `settings`. Otherwise, with a shared book here and no id
 * configured, this throws rather than stamp a change with an id no key vouches for (final review, I3).
 */
export async function localDeviceId(tx: Db): Promise<string> {
  const config = sessions.get(tx)?.config ?? configs.get(tx);
  if (config?.deviceId) return config.deviceId;
  if (!config?.standInDeviceId) {
    const shared = await tx.values(sql`SELECT 1 FROM shared_books WHERE state = 'active' LIMIT 1`);
    // A book is shared here but no device is configured: the sync engine must be made before the first write.
    if (shared.length > 0) throw new SyncNotReadyError();
  }
  const rows = await tx.values<[string]>(sql`SELECT value FROM settings WHERE key = ${DEVICE_SETTINGS_KEY}`);
  if (rows[0]) return rows[0][0];
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await tx.run(sql`INSERT INTO settings (key, value) VALUES (${DEVICE_SETTINGS_KEY}, ${id})`);
  return id;
}

export interface SharedBook {
  bookId: string;
  memberId: string;
  epoch: number;
}

/** What a purchase reads as (spec §4.3), minus `void`, which is only ever emitted as `{ void: true }`. */
export interface PurchaseFields {
  occurredOn: string;
  description: string;
  channel: 'online' | 'offline' | null;
  excluded: number;
  bill: { templateId: string; billMonth: string | null } | null;
  money: PurchaseMoney;
}

export interface PurchaseMoney {
  lines: { categoryId: string; amountMinor: number; currency: string; amountBaseMinor: number; memo: string | null }[];
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  paidBy: string;
  paidLabel: string;
}

interface LineageRow {
  lineageId: string;
  bookId: string;
  head: string | null;
  paidBy: string;
  paidLabel: string;
}

interface LineageTouch {
  lineageId: string;
  /** The `sync_lineage` row as it stood when this transaction first touched the lineage. */
  known: LineageRow | null;
  /** The purchase as the other devices know it: the known head, projected before anything here changed it. */
  before: PurchaseFields | null;
  /** Every row of the lineage this transaction posted or voided, in order. */
  touched: string[];
}

type Slot = { kind: 'rows'; ops: { bookId: string; op: Op }[] } | { kind: 'lineage'; lineageId: string };

const sessions = new WeakMap<object, CaptureSession>();

/** Opened by `createDatabase().transaction` for each db transaction; flushed before COMMIT, closed after. */
export class CaptureSession {
  private enabled: boolean;
  private books: SharedBook[] | undefined;
  private unshared: ReadonlySet<string> = new Set();
  private readonly slots: Slot[] = [];
  private readonly lineages = new Map<string, LineageTouch>();

  constructor(
    private readonly tx: Tx,
    readonly config: CaptureConfig,
  ) {
    this.enabled = config.enabled;
    sessions.set(tx, this);
  }

  pause(): void {
    this.enabled = false;
  }

  close(): void {
    if (sessions.get(this.tx) === this) sessions.delete(this.tx);
  }

  /** The shared books this device writes to, or none. The one lookup a write outside sharing costs. */
  async sharedBooks(): Promise<SharedBook[]> {
    if (!this.enabled) return [];
    if (this.books) return this.books;
    try {
      const rows = await this.tx.values<[string, string, number, string]>(
        sql`SELECT book_id, member_id, epoch, state FROM shared_books WHERE state IN ('active', 'unshared')`,
      );
      this.books = rows.filter((r) => r[3] === 'active').map(([bookId, memberId, epoch]) => ({ bookId, memberId, epoch: Number(epoch) }));
      this.unshared = new Set(rows.filter((r) => r[3] === 'unshared').map(([bookId]) => bookId));
    } catch {
      // A database stopped before migration 0056 has no sharing at all.
      this.books = [];
    }
    return this.books;
  }

  /** The books no longer shared here, read-only (§8.6). Read by the same one lookup as `sharedBooks`. */
  async readOnlyBooks(): Promise<ReadonlySet<string>> {
    await this.sharedBooks();
    return this.enabled ? this.unshared : new Set();
  }

  reserveRowSlot(): { kind: 'rows'; ops: { bookId: string; op: Op }[] } {
    const slot = { kind: 'rows' as const, ops: [] as { bookId: string; op: Op }[] };
    this.slots.push(slot);
    return slot;
  }

  async touchLineage(lineageId: string, transactionId: string): Promise<void> {
    let touch = this.lineages.get(lineageId);
    if (!touch) {
      const known = await lineageRowOf(this.tx, lineageId);
      const books = await this.sharedBooks();
      const book = known && books.find((b) => b.bookId === known.bookId);
      const before = known?.head && book ? await projectPurchase(this.tx, known.head, book.memberId, known) : null;
      touch = { lineageId, known, before, touched: [] };
      this.lineages.set(lineageId, touch);
      this.slots.push({ kind: 'lineage', lineageId });
    }
    if (!touch.touched.includes(transactionId)) touch.touched.push(transactionId);
  }

  /** Resolves the lineages, cuts the ops into change-sets, puts them in the outbox, and writes the clocks. */
  async flush(): Promise<void> {
    if (!this.enabled || this.slots.length === 0) return;
    const books = await this.sharedBooks();
    if (books.length === 0) return;
    const perBook = new Map<string, Op[]>();
    const push = (bookId: string, op: Op) => {
      const list = perBook.get(bookId) ?? [];
      list.push(op);
      perBook.set(bookId, list);
    };
    for (const slot of this.slots) {
      if (slot.kind === 'rows') {
        for (const { bookId, op } of slot.ops) push(bookId, op);
      } else {
        const resolved = await this.resolveLineage(this.lineages.get(slot.lineageId)!, books);
        if (resolved) push(resolved.bookId, resolved.op);
      }
    }
    if (perBook.size === 0) return;

    for (const [bookId, ops] of perBook) {
      await writeChangeSetsTx(this.tx, this.config, books.find((b) => b.bookId === bookId)!, ops);
    }
  }

  /** The net effect of this transaction on one lineage (spec §6.3's table). */
  private async resolveLineage(touch: LineageTouch, books: SharedBook[]): Promise<{ bookId: string; op: Op } | null> {
    const { known, lineageId } = touch;
    if (known && known.head === null) return null; // void wins, for ever
    const head = await postedHeadOf(this.tx, touch);
    const headBook = head ? await bookOfTransaction(this.tx, head) : null;

    if (known) {
      const book = books.find((b) => b.bookId === known.bookId);
      if (!book) return null;
      if (head && headBook === known.bookId) {
        const after = (await projectPurchase(this.tx, head, book.memberId, known))!;
        await this.tx.run(
          sql`UPDATE sync_lineage SET head_transaction_id = ${head}, paid_by = ${after.money.paidBy}, paid_label = ${after.money.paidLabel} WHERE lineage_id = ${lineageId}`,
        );
        const fields = diffFields(touch.before as unknown as Record<string, unknown> | null, after as unknown as Record<string, unknown>);
        return Object.keys(fields).length ? { bookId: book.bookId, op: { entity: 'purchase', id: lineageId, op: 'upsert', fields } } : null;
      }
      // Voided, or re-filed with no category line (check #18): it left the book.
      await this.tx.run(sql`UPDATE sync_lineage SET head_transaction_id = NULL WHERE lineage_id = ${lineageId}`);
      return { bookId: book.bookId, op: { entity: 'purchase', id: lineageId, op: 'upsert', fields: { void: true } } };
    }

    const book = head && headBook ? books.find((b) => b.bookId === headBook) : undefined;
    if (!head || !book) return null;
    const after = (await projectPurchase(this.tx, head, book.memberId, null))!;
    await this.tx.run(
      sql`INSERT INTO sync_lineage (lineage_id, book_id, head_transaction_id, paid_by, paid_label) VALUES (${lineageId}, ${book.bookId}, ${head}, ${after.money.paidBy}, ${after.money.paidLabel})`,
    );
    return { bookId: book.bookId, op: { entity: 'purchase', id: lineageId, op: 'upsert', fields: { ...after } } };
  }
}

/**
 * Cuts `ops` for one shared book into change-sets (spec §6.2), puts each in `sync_outbox` (plaintext, sealed at drain), and records the
 * field clocks — what a flush does, and what seeding (§6.5 step 3) does with every row in scope. Inside the caller's
 * transaction. Returns how many change-sets it wrote.
 */
export async function writeChangeSetsTx(
  tx: Tx,
  config: Pick<CaptureConfig, 'now'>,
  book: SharedBook,
  ops: readonly Op[],
  attach?: Pick<ChangeSet, 'invite'>,
): Promise<number> {
  if (ops.length === 0) return 0;
  const deviceId = await localDeviceId(tx);
  const createdAt = new Date().toISOString();
  const changeSets = await reserveAndSplit(tx, deviceId, book.memberId, ops, config.now?.());
  // An introduction's invite terms ride on its first change-set, beside the device op they vouch for (§8.2).
  if (attach && changeSets[0]) changeSets[0] = { ...changeSets[0], ...attach };
  for (const changeSet of changeSets) {
    // Plaintext: the engine seals it when it drains (§6.3, §6.6).
    await tx.run(
      sql`INSERT INTO sync_outbox (id, book_id, hlc, entry_json, created_at) VALUES (${uuidv7()}, ${book.bookId}, ${changeSet.hlc}, ${JSON.stringify(changeSet)}, ${createdAt})`,
    );
    for (const op of changeSet.ops) await recordClocks(tx, book.bookId, op, changeSet.hlc);
  }
  return changeSets.length;
}

/** The capture config a database was made with (`createDatabase` registers it). */
export function captureConfigOf(database: Database): CaptureConfig {
  const config = configs.get(database);
  if (!config) throw new Error('captureConfigOf: this database was not made by createDatabase');
  return config;
}

/** Called by `createDatabase().transaction` at BEGIN. */
export function openCaptureSession(tx: Tx, config: CaptureConfig): CaptureSession {
  return new CaptureSession(tx, config);
}

function sessionOf(tx: Db): CaptureSession | undefined {
  return sessions.get(tx);
}

/** Switches capture off for the rest of this db transaction. Apply calls it: applying never re-emits (spec §7.2). */
export function pauseCapture(tx: Db): void {
  sessionOf(tx)?.pause();
}

/**
 * Runs `fn` with capture off for the rest of this transaction, and tells the config's `pausedWrites` observer
 * where those writes begin and end, and which change-set they apply. Apply's door: what it writes was emitted by the
 * device that made the change.
 */
export async function withCapturePaused<T>(tx: Db, fn: () => Promise<T>, applying?: ChangeSet | (() => ChangeSet | undefined)): Promise<T> {
  const session = sessionOf(tx);
  session?.pause();
  const observer = session?.config.pausedWrites;
  await observer?.begin(tx, typeof applying === 'function' ? undefined : applying);
  const result = await fn();
  if (typeof applying === 'function') {
    const taken = applying();
    if (taken) await observer?.applied?.(tx, taken);
  }
  await observer?.end(tx);
  return result;
}

/**
 * Whether an entity's rows can come back after a delete (controller ruling, spec §7.2): one keyed by anything but
 * its own minted `id` — a natural key (`bill_skip`, `book_income_override`) or another row's id (`category_need`,
 * `budget_frequency`, `bill_window`) — is made again under the same `Op.id`. Its upserts always carry every field
 * (naming the ones that changed in `changed`), and record the row's existence clock `@row`, so a delete and a re-make race by hlc like any field. An entity keyed by its
 * own `id` is never made again: its tombstone wins for ever (rule 3).
 */
export function isRevivable(entity: RowEntity): boolean {
  return !(entity.keyColumns.length === 1 && entity.keyColumns[0] === 'id');
}

/** The pseudo-field holding a revivable row's existence clock. */
export const ROW_CLOCK = '@row';

export interface CaptureTarget {
  entity: string;
  /** The row's `Op.id`. Omitted: every row of the entity in a shared book is compared (for writes over many rows). */
  id?: string;
  /** Narrows the comparison to one shared book. */
  bookId?: string;
}

/**
 * Runs an in-place write of row entities and records what it changed in a shared book (spec §6.3): an upsert of the
 * fields that differ, every field for a row that entered the book, a delete for one that left it. The ops take their
 * place in the transaction's order where this call began, so a category written here precedes a purchase posted into
 * it later in the same transaction.
 */
export async function withCapture<T>(tx: Db, target: CaptureTarget | readonly CaptureTarget[], fn: () => Promise<T>): Promise<T> {
  const session = sessionOf(tx);
  if (!session) return fn();
  const books = await session.sharedBooks();
  const readOnly = await session.readOnlyBooks();
  if (books.length === 0 && readOnly.size === 0) return fn();
  const targets = Array.isArray(target) ? (target as readonly CaptureTarget[]) : [target as CaptureTarget];
  // §8.6 (task 9a): a book no longer shared keeps every row as it was. Any change to one of its rows is refused here,
  // before anything is emitted, and rolls the whole transaction back. Only the targets that can be in such a book are
  // looked at (final review, minor 8): one that names another book, or a row keyed by another book's id, cannot be.
  const frozenTargets = readOnly.size > 0 ? targets.filter((t) => couldBeIn(t, readOnly)) : [];
  if (frozenTargets.length > 0) {
    const frozen = [...readOnly].filter((bookId) => frozenTargets.some((t) => couldBeIn(t, new Set([bookId])))).map((bookId) => ({ bookId, memberId: '', epoch: 0 }));
    const was = await snapshot(tx, frozen, frozenTargets);
    const inner = fn;
    fn = async () => {
      const result = await inner();
      const now = await snapshot(tx, frozen, frozenTargets);
      for (const [key, row] of was) {
        const after = now.get(key);
        if (!after || JSON.stringify([after.values, after.derived]) !== JSON.stringify([row.values, row.derived])) throw new BookReadOnlyError(row.bookId);
      }
      for (const [key, row] of now) if (!was.has(key)) throw new BookReadOnlyError(row.bookId);
      return result;
    };
  }
  if (books.length === 0) return fn();
  const slot = session.reserveRowSlot();
  const before = await snapshot(tx, books, targets);
  const result = await fn();
  // §8.5 (fix rounds 2–4): a shared book always keeps an owner. Deleting or demoting an owner is refused here, before
  // anything is emitted, and rolls the write back, when either the authority view has that member as the book's only
  // owner (the log's say, which a local self-promotion cannot change), or this device's rows would be left with no owner
  // at all (its own earlier writes still on their way to the log, or one statement over every owner). A write that
  // would be put back by the log anyway is not worth emitting.
  for (const was of before.values()) {
    if (was.entity.entity !== 'member' || was.values.role !== 'owner') continue;
    const [now] = await tx.values<[string]>(sql`SELECT role FROM book_members WHERE book_id = ${was.bookId} AND member_id = ${was.id}`);
    if (now?.[0] === 'owner') continue;
    if (await viewIsLastOwner(tx, was.bookId, was.id)) throw new LastOwnerError();
    const [owners] = await tx.values<[number]>(sql`SELECT count(*) FROM book_members WHERE book_id = ${was.bookId} AND role = 'owner'`);
    if (Number(owners?.[0] ?? 0) === 0) throw new LastOwnerError();
  }
  const after = await snapshot(tx, books, targets);
  for (const [key, was] of before) {
    const now = after.get(key);
    if (!now || now.bookId !== was.bookId) {
      const gone: Op = { entity: was.entity.entity, id: was.id, op: 'delete' };
      // A revivable row's last values stay beside its tombstone, for a revive to merge with (§7.2).
      if (isRevivable(was.entity)) retainedValues.set(gone, was.values);
      slot.ops.push({ bookId: was.bookId, op: gone });
      if (now) slot.ops.push({ bookId: now.bookId, op: await fullUpsert(tx, now, books) });
      continue;
    }
    const fields = diffFields(was.values, now.values);
    await deriveFields(tx, was, now, fields, books);
    if (Object.keys(fields).length === 0) continue;
    // A revivable row travels whole, so a re-make after a delete never arrives as a fragment (see isRevivable).
    // It names what changed: only those fields win on a receiver (rule 1 stays per field).
    // Every other field it carries says the hlc it last changed at, so a receiver merges it by that clock (§7.2).
    if (isRevivable(now.entity)) {
      const whole = (await fullUpsert(tx, now, books)) as Extract<Op, { op: 'upsert' }>;
      const changed = Object.keys(fields);
      const clocks = await fieldClocksOf(tx, now.bookId, now.entity.entity, now.id, Object.keys(whole.fields).filter((f) => !changed.includes(f)));
      slot.ops.push({ bookId: now.bookId, op: { ...whole, changed, ...(Object.keys(clocks).length ? { clocks } : {}) } });
    }
    else slot.ops.push({ bookId: now.bookId, op: { entity: now.entity.entity, id: now.id, op: 'upsert', fields } });
  }
  for (const [key, now] of after) {
    if (!before.has(key)) slot.ops.push({ bookId: now.bookId, op: await fullUpsert(tx, now, books) });
  }
  return result;
}

/** Whether a target's rows can lie in one of `bookIds`: not when it names another book, nor when its row is keyed by another book's id. */
function couldBeIn(target: CaptureTarget, bookIds: ReadonlySet<string>): boolean {
  if (target.bookId !== undefined) return bookIds.has(target.bookId);
  if (target.id === undefined) return true;
  const entity = rowEntity(target.entity);
  const keyedByBook = entity.scopeRule === 'id = bookId' || (entity.keyColumns.length === 1 && entity.keyColumns[0] === 'book_id');
  return keyedByBook ? bookIds.has(target.id) : true;
}

interface RowState {
  entity: RowEntity;
  bookId: string;
  id: string;
  values: Record<string, unknown>;
  derived: Record<string, unknown[]>;
}

function rowEntity(name: string): RowEntity {
  const entity = entityOf(name);
  if (entity.kind !== 'row') throw new Error(`withCapture: ${name} is not an in-place entity`);
  return entity;
}

async function snapshot(tx: Db, books: readonly SharedBook[], targets: readonly CaptureTarget[]): Promise<Map<string, RowState>> {
  const out = new Map<string, RowState>();
  for (const target of targets) {
    const entity = rowEntity(target.entity);
    const fieldNames = Object.keys(entity.fields);
    const derivedNames = Object.keys(entity.derivedFields ?? {});
    const derivedColumns = derivedNames.flatMap((name) => entity.derivedFields![name]!);
    const columns = [...entity.keyColumns, ...fieldNames.map((f) => entity.fields[f]!), ...derivedColumns];
    const select = sql.raw(columns.map((c) => `t.${c}`).join(', '));
    let keyMatch: SQL = sql`1 = 1`;
    if (target.id !== undefined) {
      const key = parseOpId(entity, target.id);
      for (const column of entity.keyColumns) keyMatch = sql`${keyMatch} AND t.${sql.raw(column)} = ${key[column]}`;
    }
    for (const book of books) {
      if (target.bookId && target.bookId !== book.bookId) continue;
      const rows = await tx.values<unknown[]>(sql`SELECT ${select} FROM ${sql.raw(entity.table)} t WHERE ${keyMatch} AND ${entity.scope(book.bookId)}`);
      for (const row of rows) {
        const key = Object.fromEntries(entity.keyColumns.map((column, i) => [column, String(row[i])]));
        const id = buildOpId(entity, key);
        const values: Record<string, unknown> = {};
        fieldNames.forEach((name, i) => (values[name] = row[entity.keyColumns.length + i]));
        const derived: Record<string, unknown[]> = {};
        let at = entity.keyColumns.length + fieldNames.length;
        for (const name of derivedNames) {
          const width = entity.derivedFields![name]!.length;
          derived[name] = row.slice(at, at + width);
          at += width;
        }
        out.set(`${entity.entity}\u0000${id}`, { entity, bookId: book.bookId, id, values, derived });
      }
    }
  }
  return out;
}

async function fullUpsert(tx: Db, row: RowState, books: readonly SharedBook[]): Promise<Op> {
  const fields: Record<string, unknown> = { ...row.values };
  await deriveFields(tx, null, row, fields, books);
  return { entity: row.entity.entity, id: row.id, op: 'upsert', fields };
}

/** Adds each derived field (a bill's `payer`) whose columns changed, or every one when there is no before. */
async function deriveFields(tx: Db, before: RowState | null, after: RowState, fields: Record<string, unknown>, books: readonly SharedBook[]): Promise<void> {
  for (const [name, values] of Object.entries(after.derived)) {
    if (before && JSON.stringify(before.derived[name]) === JSON.stringify(values)) continue;
    if (after.entity.entity === 'bill' && name === 'payer') {
      const memberId = books.find((b) => b.bookId === after.bookId)!.memberId;
      fields.payer = await payerOf(tx, String(values[0]), memberId);
    }
  }
}

/** A bill's payer (spec §4.4): the member whose account pays it, and that account's name. */
async function payerOf(tx: Db, accountId: string, memberId: string): Promise<{ memberId: string; label: string }> {
  const rows = await tx.values<[string, string | null]>(
    sql`SELECT a.name, (SELECT m.member_id FROM book_member_accounts m WHERE m.account_id = a.id) FROM accounts a WHERE a.id = ${accountId}`,
  );
  const [name, placeholderMember] = rows[0] ?? ['', null];
  return { memberId: placeholderMember ?? memberId, label: name };
}

function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(after)) {
    if (!before || JSON.stringify(before[field]) !== JSON.stringify(value)) out[field] = value;
  }
  return out;
}

/** The values a revivable row had when this device deleted it: never sent, kept beside the tombstone. */
const retainedValues = new WeakMap<Op, Record<string, unknown>>();

/** This device's clocks for some fields of a row, as an op carries them (fields with no clock are left out). */
async function fieldClocksOf(tx: Db, bookId: string, entity: string, id: string, fields: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const rows = await tx.values<[string]>(sql`SELECT hlc FROM sync_field_clocks WHERE book_id = ${bookId} AND entity = ${entity} AND id = ${id} AND field = ${field}`);
    if (rows[0]) out[field] = rows[0][0];
  }
  return out;
}

export async function recordClocks(tx: Db, bookId: string, op: Op, hlc: string): Promise<void> {
  if (op.op === 'delete') {
    const last = retainedValues.get(op);
    await tx.run(
      sql`INSERT INTO sync_tombstones (book_id, entity, id, hlc, last_json) VALUES (${bookId}, ${op.entity}, ${op.id}, ${hlc}, ${last ? JSON.stringify(last) : null}) ON CONFLICT (book_id, entity, id) DO UPDATE SET hlc = excluded.hlc, last_json = coalesce(excluded.last_json, last_json)`,
    );
    return;
  }
  // A row this device deleted and made again under the same key is alive here again.
  await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${bookId} AND entity = ${op.entity} AND id = ${op.id}`);
  const entity = entityOf(op.entity);
  const named = op.changed ?? Object.keys(op.fields);
  // A member row's existence is an owner's (§8.5, fix round 2): a non-owner's edit of one does not move its existence
  // clock here either, so an owner's delete that crossed it wins on this device as it does everywhere.
  const existence = entity.kind === 'row' && isRevivable(entity) && (op.entity !== 'member' || makesMember(op) || (await selfIsOwner(tx, bookId)));
  const fields = existence ? [...named, ROW_CLOCK] : named;
  for (const field of fields) {
    await tx.run(
      sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${bookId}, ${op.entity}, ${op.id}, ${field}, ${hlc}) ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = excluded.hlc`,
    );
  }
  // A field sent at its own clock (a revivable row's other fields; a seed or rejoin at the clocks it kept, N2) is at
  // that clock here too, as on every receiver that takes it.
  // Never later than the change-set (re-review, NEW-1), as every receiver takes it.
  for (const [field, carried] of Object.entries(op.clocks ?? {})) {
    if (named.includes(field)) continue;
    const at = carried > hlc ? hlc : carried;
    await tx.run(
      sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${bookId}, ${op.entity}, ${op.id}, ${field}, ${at}) ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = max(hlc, excluded.hlc)`,
    );
  }
}

/**
 * A full upsert of every row of one in-place entity in the book (spec §6.5 step 2), in rowid order. Seeding's source:
 * the same snapshot and derivation capture uses, so a seeded row reads exactly as a later capture of it would.
 */
export async function rowUpsertsTx(tx: Db, book: SharedBook, entityName: string): Promise<Op[]> {
  const rows = await snapshot(tx, [book], [{ entity: entityName, bookId: book.bookId }]);
  const ops: Op[] = [];
  for (const row of rows.values()) ops.push(await fullUpsert(tx, row, [book]));
  return ops;
}

/* ---------------------------------------------------------------- purchases */

async function lineageRowOf(tx: Db, lineageId: string): Promise<LineageRow | null> {
  const rows = await tx.values<[string, string | null, string, string]>(
    sql`SELECT book_id, head_transaction_id, paid_by, paid_label FROM sync_lineage WHERE lineage_id = ${lineageId}`,
  );
  const row = rows[0];
  return row ? { lineageId, bookId: row[0], head: row[1], paidBy: row[2], paidLabel: row[3] } : null;
}

/**
 * The lineage a transaction row belongs to: the lineage whose head it is, else the root of its
 * `replaces_transaction_id` chain (the first row's id — which is also what apply posts a new lineage under).
 */
export async function lineageOfTransaction(tx: Db, transactionId: string): Promise<string> {
  const headOf = await tx.values<[string]>(sql`SELECT lineage_id FROM sync_lineage WHERE head_transaction_id = ${transactionId}`);
  if (headOf[0]) return headOf[0][0];
  const rows = await tx.values<[string]>(sql`
    WITH RECURSIVE chain(id, prev, depth) AS (
      SELECT id, replaces_transaction_id, 0 FROM transactions WHERE id = ${transactionId}
      UNION ALL
      SELECT t.id, t.replaces_transaction_id, c.depth + 1 FROM transactions t JOIN chain c ON t.id = c.prev
    )
    SELECT id FROM chain ORDER BY depth DESC LIMIT 1`);
  return rows[0]?.[0] ?? transactionId;
}

async function bookOfTransaction(tx: Db, transactionId: string): Promise<string | null> {
  const rows = await tx.values<[string]>(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${transactionId}`);
  return rows[0]?.[0] ?? null;
}

/** The lineage's posted row after this transaction: the latest touched row still posted, else the known head. */
async function postedHeadOf(tx: Db, touch: LineageTouch): Promise<string | null> {
  const candidates = [...touch.touched].reverse();
  if (touch.known?.head && !candidates.includes(touch.known.head)) candidates.push(touch.known.head);
  for (const id of candidates) {
    const rows = await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`);
    if (rows[0]?.[0] === 'posted') return id;
  }
  return null;
}

/**
 * What a posted row reads as, as a purchase (spec §4.3). `memberId` is this device's member in the row's book; the
 * payer is this member when the money side names one of this device's own accounts, else the member whose
 * placeholder account it names (keeping the label the lineage already carries).
 */
export async function projectPurchase(tx: Db, transactionId: string, memberId: string, known: Pick<LineageRow, 'paidBy' | 'paidLabel'> | null): Promise<PurchaseFields | null> {
  const [row] = await tx.values<[string, string, string | null, string | null, number | null, string | null]>(
    sql`SELECT occurred_on, description, template_id, original_currency, original_amount_minor, card_id FROM transactions WHERE id = ${transactionId}`,
  );
  if (!row) return null;
  const [occurredOn, description, templateId, originalCurrency, originalAmountMinor, cardId] = row;
  const [flags] = await tx.values<[string | null, number]>(sql`SELECT channel, excluded FROM transaction_flags WHERE transaction_id = ${transactionId}`);
  const [payment] = await tx.values<[string, string]>(sql`SELECT template_id, bill_month FROM bill_payments WHERE transaction_id = ${transactionId}`);
  const entryRows = await tx.values<[string, number, string, number, string | null, string, string, string | null]>(sql`
    SELECT e.account_id, e.amount_minor, e.currency, e.amount_base_minor, e.memo, a.kind, a.name,
           (SELECT m.member_id FROM book_member_accounts m WHERE m.account_id = e.account_id)
    FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE e.transaction_id = ${transactionId}
    ORDER BY e.rowid`);

  const lines: PurchaseMoney['lines'] = [];
  const moneySide: { accountId: string; name: string; placeholderMember: string | null }[] = [];
  for (const [accountId, amountMinor, currency, amountBaseMinor, memo, kind, name, placeholderMember] of entryRows) {
    if (kind === 'income' || kind === 'expense') {
      lines.push({ categoryId: accountId, amountMinor: Number(amountMinor), currency, amountBaseMinor: Number(amountBaseMinor), memo });
    } else if (!moneySide.some((m) => m.accountId === accountId)) {
      moneySide.push({ accountId, name, placeholderMember });
    }
  }

  let paidBy: string;
  let paidLabel: string;
  const own = moneySide.filter((m) => m.placeholderMember === null);
  if (own.length > 0) {
    paidBy = memberId;
    const [card] = cardId ? await tx.values<[string, string | null]>(sql`SELECT account_id, last4 FROM cards WHERE id = ${cardId}`) : [];
    paidLabel = own.map((m) => (card && card[1] && card[0] === m.accountId ? `${m.name} ···· ${card[1]}` : m.name)).join(' + ');
  } else if (moneySide.length > 0) {
    paidBy = moneySide[0]!.placeholderMember!;
    paidLabel = known?.paidLabel ?? moneySide.map((m) => m.name).join(' + ');
  } else {
    paidBy = known?.paidBy ?? memberId;
    paidLabel = known?.paidLabel ?? '';
  }

  return {
    occurredOn,
    description,
    channel: (flags?.[0] ?? null) as PurchaseFields['channel'],
    excluded: Number(flags?.[1] ?? 0),
    bill: templateId ? { templateId: payment?.[0] ?? templateId, billMonth: payment?.[1] ?? null } : null,
    money: {
      lines,
      originalCurrency,
      originalAmountMinor: originalAmountMinor === null ? null : Number(originalAmountMinor),
      paidBy,
      paidLabel,
    },
  };
}

/**
 * The ledger's insert door (`postTransactionTx`): records the new row's lineage — the lineage of the row it replaces,
 * or a new one rooted at itself. Cheap when nothing is shared: a fresh post filed in no shared book returns after the
 * one lookup.
 */
export async function capturePostedTx(tx: Db, transactionId: string, bookId: string | null, replacesTransactionId: string | null): Promise<void> {
  const session = sessionOf(tx);
  if (!session) return;
  const books = await session.sharedBooks();
  const readOnly = await session.readOnlyBooks();
  if (readOnly.size > 0) {
    // §8.6: nothing is posted into a book no longer shared, nor does anything in it change.
    if (bookId && readOnly.has(bookId)) throw new BookReadOnlyError(bookId);
    const replaced = replacesTransactionId ? await bookOfTransaction(tx, replacesTransactionId) : null;
    if (replaced && readOnly.has(replaced)) throw new BookReadOnlyError(replaced);
  }
  if (books.length === 0) return;
  if (replacesTransactionId === null) {
    if (bookId && books.some((b) => b.bookId === bookId)) await session.touchLineage(transactionId, transactionId);
    return;
  }
  const lineageId = await lineageOfTransaction(tx, replacesTransactionId);
  const inShared = (bookId && books.some((b) => b.bookId === bookId)) || (await lineageRowOf(tx, lineageId)) !== null;
  if (inShared) await session.touchLineage(lineageId, transactionId);
}

/** The ledger's void door (`markVoidTx`), called before the status changes, so the lineage's before is still readable. */
export async function captureVoidingTx(tx: Db, transactionId: string): Promise<void> {
  const session = sessionOf(tx);
  if (!session) return;
  const books = await session.sharedBooks();
  const readOnly = await session.readOnlyBooks();
  if (books.length === 0 && readOnly.size === 0) return;
  const bookId = await bookOfTransaction(tx, transactionId);
  if (bookId && readOnly.has(bookId)) throw new BookReadOnlyError(bookId); // §8.6
  if (books.length === 0) return;
  const lineageId = await lineageOfTransaction(tx, transactionId);
  const inShared = (bookId && books.some((b) => b.bookId === bookId)) || (await lineageRowOf(tx, lineageId)) !== null;
  if (inShared) await session.touchLineage(lineageId, transactionId);
}

/** Every in-place entity, for a write that may touch any of them. */
export const ALL_ROW_ENTITIES: readonly string[] = SHARED_ENTITIES.filter((e) => e.kind === 'row').map((e) => e.entity);
