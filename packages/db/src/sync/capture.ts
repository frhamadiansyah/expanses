import { uuidv7 } from '@expanses/core';
import { sql, type SQL } from 'drizzle-orm';
import type { Database, Db, Tx } from '../database';
import { IdentitySealer, type Sealer } from './seal';
import { buildOpId, entityOf, parseOpId, SHARED_ENTITIES, type RowEntity } from './shared-entities';
import { reserveAndSplit } from './split';
import type { ChangeSet, Op } from './types';

/*
 * Capture (household-sharing spec §6.3): turning local writes to a shared book into ops, and ops into sealed
 * change-sets in `sync_outbox`, inside the very database transaction that made the writes — so a change-set is
 * durable exactly when its rows are (ruled O1).
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

/** The settings key holding this device's sync id until the KeyStore owns it (task 5 swaps `localDeviceId`'s body). */
export const DEVICE_SETTINGS_KEY = 'sync.device';

export interface CaptureConfig {
  /** Off: no transaction on this database captures anything. */
  enabled: boolean;
  /** How a change-set is sealed for this device. The identity stub until task 5's real keys. */
  sealerFor: (deviceId: string) => Sealer;
  /** The clock's wall time, for tests. */
  now?: () => number;
  /**
   * Told when a transaction writes with capture deliberately off (`withCapturePaused`: apply writing what another
   * device already emitted). The §6.4 test harness uses it to leave those writes out of its watch, and only those.
   */
  pausedWrites?: { begin(tx: Db, changeSet?: ChangeSet): Promise<void>; end(tx: Db): Promise<void> };
}

export function defaultCaptureConfig(): CaptureConfig {
  return { enabled: true, sealerFor: (deviceId) => new IdentitySealer(deviceId) };
}

const configs = new WeakMap<object, CaptureConfig>();

/** Called by `createDatabase` so `configureCapture(database, …)` reaches the config its transactions read. */
export function registerCaptureConfig(database: object, config: CaptureConfig): void {
  configs.set(database, config);
}

/** Switches capture on or off for a database, or changes how it seals (task 5 passes the real sealer here). */
export function configureCapture(database: Database, patch: Partial<CaptureConfig>): void {
  const config = configs.get(database);
  if (!config) throw new Error('configureCapture: this database was not made by createDatabase');
  Object.assign(config, patch);
}

/**
 * This device's id for sync. For now a random id kept in `settings` under `sync.device`, made on first need; task 5
 * replaces the body with the KeyStore's `deviceId` (spec §5.1) and nothing else changes.
 */
export async function localDeviceId(tx: Db): Promise<string> {
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
      const rows = await this.tx.values<[string, string, number]>(sql`SELECT book_id, member_id, epoch FROM shared_books WHERE state = 'active'`);
      this.books = rows.map(([bookId, memberId, epoch]) => ({ bookId, memberId, epoch: Number(epoch) }));
    } catch {
      // A database stopped before migration 0056 has no sharing at all.
      this.books = [];
    }
    return this.books;
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

  /** Resolves the lineages, cuts the ops into change-sets, seals them into the outbox, and writes the clocks. */
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
 * Cuts `ops` for one shared book into change-sets (spec §6.2), seals each, puts it in `sync_outbox`, and records the
 * field clocks — what a flush does, and what seeding (§6.5 step 3) does with every row in scope. Inside the caller's
 * transaction. Returns how many change-sets it wrote.
 */
export async function writeChangeSetsTx(tx: Tx, config: Pick<CaptureConfig, 'sealerFor' | 'now'>, book: SharedBook, ops: readonly Op[]): Promise<number> {
  if (ops.length === 0) return 0;
  const deviceId = await localDeviceId(tx);
  const sealer = config.sealerFor(deviceId);
  const createdAt = new Date().toISOString();
  const changeSets = await reserveAndSplit(tx, deviceId, book.memberId, ops, config.now?.());
  for (const changeSet of changeSets) {
    const entry = await sealer.seal(book.bookId, book.epoch, changeSet);
    await tx.run(
      sql`INSERT INTO sync_outbox (id, book_id, hlc, entry_json, created_at) VALUES (${uuidv7()}, ${book.bookId}, ${changeSet.hlc}, ${JSON.stringify(entry)}, ${createdAt})`,
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
export async function withCapturePaused<T>(tx: Db, fn: () => Promise<T>, applying?: ChangeSet): Promise<T> {
  const session = sessionOf(tx);
  session?.pause();
  const observer = session?.config.pausedWrites;
  await observer?.begin(tx, applying);
  const result = await fn();
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
  if (books.length === 0) return fn();
  const targets = Array.isArray(target) ? (target as readonly CaptureTarget[]) : [target as CaptureTarget];
  const slot = session.reserveRowSlot();
  const before = await snapshot(tx, books, targets);
  const result = await fn();
  const after = await snapshot(tx, books, targets);
  for (const [key, was] of before) {
    const now = after.get(key);
    if (!now || now.bookId !== was.bookId) {
      slot.ops.push({ bookId: was.bookId, op: { entity: was.entity.entity, id: was.id, op: 'delete' } });
      if (now) slot.ops.push({ bookId: now.bookId, op: await fullUpsert(tx, now, books) });
      continue;
    }
    const fields = diffFields(was.values, now.values);
    await deriveFields(tx, was, now, fields, books);
    if (Object.keys(fields).length === 0) continue;
    // A revivable row travels whole, so a re-make after a delete never arrives as a fragment (see isRevivable).
    // It names what changed: only those fields win on a receiver (rule 1 stays per field).
    if (isRevivable(now.entity)) slot.ops.push({ bookId: now.bookId, op: { ...(await fullUpsert(tx, now, books)), changed: Object.keys(fields) } as Op });
    else slot.ops.push({ bookId: now.bookId, op: { entity: now.entity.entity, id: now.id, op: 'upsert', fields } });
  }
  for (const [key, now] of after) {
    if (!before.has(key)) slot.ops.push({ bookId: now.bookId, op: await fullUpsert(tx, now, books) });
  }
  return result;
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

export async function recordClocks(tx: Db, bookId: string, op: Op, hlc: string): Promise<void> {
  if (op.op === 'delete') {
    await tx.run(
      sql`INSERT INTO sync_tombstones (book_id, entity, id, hlc) VALUES (${bookId}, ${op.entity}, ${op.id}, ${hlc}) ON CONFLICT (book_id, entity, id) DO UPDATE SET hlc = excluded.hlc`,
    );
    return;
  }
  // A row this device deleted and made again under the same key is alive here again.
  await tx.run(sql`DELETE FROM sync_tombstones WHERE book_id = ${bookId} AND entity = ${op.entity} AND id = ${op.id}`);
  const entity = entityOf(op.entity);
  const named = op.changed ?? Object.keys(op.fields);
  const fields = entity.kind === 'row' && isRevivable(entity) ? [...named, ROW_CLOCK] : named;
  for (const field of fields) {
    await tx.run(
      sql`INSERT INTO sync_field_clocks (book_id, entity, id, field, hlc) VALUES (${bookId}, ${op.entity}, ${op.id}, ${field}, ${hlc}) ON CONFLICT (book_id, entity, id, field) DO UPDATE SET hlc = excluded.hlc`,
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
  if (books.length === 0) return;
  const bookId = await bookOfTransaction(tx, transactionId);
  const lineageId = await lineageOfTransaction(tx, transactionId);
  const inShared = (bookId && books.some((b) => b.bookId === bookId)) || (await lineageRowOf(tx, lineageId)) !== null;
  if (inShared) await session.touchLineage(lineageId, transactionId);
}

/** Every in-place entity, for a write that may touch any of them. */
export const ALL_ROW_ENTITIES: readonly string[] = SHARED_ENTITIES.filter((e) => e.kind === 'row').map((e) => e.entity);
