import { formatMinor, type PostingLine, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { auditLog } from '../schema';
import { unarchiveAccountTx } from './accounts';
import { hasBooks } from './books';
import { excludedLinesTx, splitBooksOfTx } from './book-splits';
import { dayOrderExists } from './day-order-column';
import { eventPostingOfTx } from './event-only';
import { exactExists } from './exact-column';
import { type PostTransactionInput, postTransactionTx, replaceTransactionTx, voidTransactionTx } from './ledger';
import { fileTransferTx } from './move-group';
import { extrasForTx } from './transaction-extras';

/*
 * Activity: a history of what was changed by hand, with Undo where it is safely possible (Settings → Activity).
 *
 * What it reads. The ledger never erases a transaction: an edit voids the old row and writes a replacement chained to it
 * by `replaces_transaction_id`, a delete only sets the void flag. So the earlier version of an edited transaction is
 * still a whole row — lines, rates, day, words — and Undo never needs a stored copy. The doors a person uses leave one
 * `activity` row in the audit log (`activity-log.ts`); a change another member made arrives with `syncAuthor` in the
 * ledger's own audit rows, and is read from there.
 *
 * What Undo does. It never writes a balance. An edit is undone by editing again — `replaceTransactionTx` with the
 * earlier version's figures, a NEW row that supersedes the current one, so history is only ever added to — and only
 * while the row an edit produced is still the newest version of its lineage. A delete is undone by posting the same
 * purchase again as a new row (a void is permanent in the sync model, so there is no row to revive). A move to another
 * workspace is an edit with a book change, and moves back the same way. A bill payment and a new purchase are voided.
 * Each undo leaves one `undo` row, which is a line of its own in the list and marks its target as undone, so a second
 * Undo is refused.
 */

export type ActivityKind = 'edit' | 'delete' | 'create' | 'move' | 'payment' | 'rename' | 'other';
export type ActivityGroup = 'transactions' | 'accounts';

/** The page's own words for a line's right-hand side. */
export type ActivityState =
  /** Reversible now. */
  | 'open'
  /** Already undone. */
  | 'undone'
  /** The row was changed again since, so the earlier version is no longer the one to go back to. */
  | 'changed'
  /** Recorded, but nothing earlier was kept to go back to (a rename keeps only the new name). */
  | 'cannot'
  /** A deleted workspace: the app took a safety copy first. */
  | 'safety'
  /** An undo itself, as a line. */
  | 'log';

export type ActivityUndo =
  | { kind: 'edit'; newId: string; oldId: string }
  | { kind: 'move'; items: { newId: string; oldId: string }[]; toBookId: string }
  | { kind: 'delete'; transactionId: string }
  | { kind: 'remove'; transactionId: string }
  | { kind: 'unarchive'; accountId: string };

export interface ActivityChange {
  field: string;
  from: string;
  to: string;
}

export interface ActivityLine {
  /** The id of the audit row this line is (the first of a group of moves). */
  id: string;
  at: string;
  kind: ActivityKind;
  group: ActivityGroup;
  title: string;
  subtitle: string;
  /** The member who did it, when the workspace is shared; null on a phone with nobody to tell apart. */
  who: string | null;
  changes: ActivityChange[];
  state: ActivityState;
  undo: ActivityUndo | null;
  /** The transaction as it stands now, when there is one to open. */
  transactionId: string | null;
}

export class ActivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityError';
  }
}

// ---------------------------------------------------------------------------------------------- reading a version

interface VLine {
  accountId: string;
  amountMinor: number;
  currency: string;
  rate: number;
  baseMinor: number;
  memo: string | null;
  spendCategoryId: string | null;
  name: string;
  kind: string;
}

interface Version {
  id: string;
  occurredOn: string;
  description: string;
  status: string;
  source: string;
  externalRef: string | null;
  templateId: string | null;
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  mcc: string | null;
  cardId: string | null;
  eventId: string | null;
  lines: VLine[];
  books: string[];
}

async function booksOf(db: Db, id: string): Promise<string[]> {
  if (!(await hasBooks(db))) return [];
  const filed = await db.values<[string]>(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${id}`);
  return filed.length > 0 ? filed.map(([bookId]) => bookId) : splitBooksOfTx(db, id);
}

async function versionOf(db: Db, ws: WorkspaceContext, id: string): Promise<Version | null> {
  const [row] = await db.values<[string, string, string, string, string | null, string | null, string | null, number | null, string | null, string | null, string | null]>(sql`
    SELECT occurred_on, description, status, source, external_ref, template_id, original_currency, original_amount_minor, mcc, card_id, event_id
    FROM transactions WHERE id = ${id} AND workspace_id = ${ws.workspaceId}`);
  if (!row) return null;
  const lines = await db.values<[string, number, string, number, number, string | null, string | null, string, string]>(sql`
    SELECT e.account_id, e.amount_minor, e.currency, e.fx_rate_to_base, e.amount_base_minor, e.memo, e.spend_category_id, a.name, a.kind
    FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${id} ORDER BY e.rowid`);
  return {
    id,
    occurredOn: row[0],
    description: row[1],
    status: row[2],
    source: row[3],
    externalRef: row[4],
    templateId: row[5],
    originalCurrency: row[6],
    originalAmountMinor: row[7] === null ? null : Number(row[7]),
    mcc: row[8],
    cardId: row[9],
    eventId: row[10],
    lines: lines.map(([accountId, amountMinor, currency, rate, baseMinor, memo, spendCategoryId, name, kind]) => ({
      accountId,
      amountMinor: Number(amountMinor),
      currency,
      rate: Number(rate),
      baseMinor: Number(baseMinor),
      memo,
      spendCategoryId,
      name,
      kind,
    })),
    books: await booksOf(db, id),
  };
}

const isCategory = (line: VLine) => line.kind === 'income' || line.kind === 'expense';

/** The figure a transaction is about: what it spent or earned, else the money that moved. */
function headline(v: Version): { amountMinor: number; currency: string } | null {
  const spent = v.lines.filter(isCategory);
  if (spent.length > 0) return { amountMinor: Math.abs(spent.reduce((sum, line) => sum + line.amountMinor, 0)), currency: spent[0]!.currency };
  const moved = v.lines.filter((line) => line.amountMinor > 0 && line.kind !== 'equity');
  if (moved.length === 0) return null;
  return { amountMinor: moved.reduce((sum, line) => sum + line.amountMinor, 0), currency: moved[0]!.currency };
}

const moneyText = (figure: { amountMinor: number; currency: string } | null) => (figure ? formatMinor(figure.amountMinor, figure.currency) : '');

/** The accounts the money went through: out of, then into, for a transfer; the one it was paid from, for a purchase. */
function accountsText(v: Version): string {
  const money = v.lines.filter((line) => !isCategory(line) && line.kind !== 'equity');
  const out = [...new Set(money.filter((line) => line.amountMinor < 0).map((line) => line.name))];
  const into = [...new Set(money.filter((line) => line.amountMinor > 0).map((line) => line.name))];
  if (v.lines.some(isCategory)) return (out.length > 0 ? out : into).join(', ');
  return [out.join(', '), into.join(', ')].filter(Boolean).join(' → ');
}

const categoriesText = (v: Version) => [...new Set(v.lines.filter(isCategory).map((line) => line.name))].join(', ');

async function bookName(db: Db, id: string | undefined): Promise<string> {
  if (!id) return '';
  const [row] = await db.values<[string]>(sql`SELECT name FROM books WHERE id = ${id}`);
  return row?.[0] ?? '';
}

/** What differs between two versions of one transaction, in the order a person looks for it. */
function diffOf(before: Version, after: Version): ActivityChange[] {
  const out: ActivityChange[] = [];
  const add = (field: string, from: string, to: string) => {
    if (from !== to) out.push({ field, from, to });
  };
  add('Category', categoriesText(before), categoriesText(after));
  const a = headline(before);
  const b = headline(after);
  if (a?.amountMinor !== b?.amountMinor || a?.currency !== b?.currency) add('Amount', moneyText(a), moneyText(b));
  add('Date', before.occurredOn, after.occurredOn);
  add('Account', accountsText(before), accountsText(after));
  add('Note', before.description, after.description);
  return out;
}

/** The first changed field, and how many more. */
function summaryOf(changes: readonly ActivityChange[]): string {
  const first = changes[0];
  if (!first) return '';
  const more = changes.length > 1 ? ` +${changes.length - 1}` : '';
  const from = first.from || 'none';
  const to = first.to || 'none';
  return `${first.field} ${from} → ${to}${more}`;
}

const figureLine = (v: Version) => [moneyText(headline(v)), accountsText(v)].filter(Boolean).join(' · ');

// ----------------------------------------------------------------------------------------------- the event stream

interface AuditEvent {
  id: string;
  at: string;
  /** Where it came from: a person's doing on this phone, a member's change that arrived by sync, an account, a workspace. */
  src: 'mark' | 'sync' | 'account' | 'book';
  op: string;
  entityId: string;
  payload: Record<string, unknown>;
}

function parse(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const SCAN = 4000;

async function eventsOf(db: Db, ws: WorkspaceContext): Promise<AuditEvent[]> {
  const rows = await db.values<[string, string, string, string, string, string]>(sql`
    SELECT id, action, entity, entity_id, payload_json, created_at FROM audit_log
    WHERE workspace_id = ${ws.workspaceId} AND (
      entity = 'activity'
      OR (entity = 'transaction' AND action IN ('post', 'void') AND payload_json LIKE '%"syncAuthor"%')
      OR (entity = 'account' AND action = 'rename')
      OR (entity = 'book' AND action = 'delete'))
    ORDER BY created_at DESC, rowid DESC LIMIT ${SCAN}`);
  return rows.map(([id, action, entity, entityId, payloadJson, createdAt]) => ({
    id,
    at: createdAt,
    src: entity === 'activity' ? 'mark' : entity === 'transaction' ? 'sync' : entity === 'account' ? 'account' : 'book',
    op: action,
    entityId,
    payload: parse(payloadJson),
  }));
}

async function hasReplacement(db: Db, id: string): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM transactions WHERE replaces_transaction_id = ${id} LIMIT 1`)).length > 0;
}

/**
 * The member's name as the transaction's own books have it (a member renames themselves per workspace, D-D2), else as
 * any book here has it.
 */
async function memberName(db: Db, memberId: string, bookIds: readonly string[]): Promise<string | null> {
  try {
    for (const bookId of bookIds) {
      const [row] = await db.values<[string]>(sql`SELECT name FROM book_members WHERE book_id = ${bookId} AND member_id = ${memberId}`);
      if (row) return row[0];
    }
    const [row] = await db.values<[string]>(sql`SELECT name FROM book_members WHERE member_id = ${memberId} LIMIT 1`);
    return row?.[0] ?? null;
  } catch {
    return null;
  }
}

/** This phone's own member in a shared workspace, so "By" reads the same for every line there; null when nothing is shared. */
async function myName(db: Db, bookIds: readonly string[]): Promise<string | null> {
  try {
    for (const bookId of bookIds) {
      const [row] = await db.values<[string]>(sql`
        SELECT m.name FROM shared_books s JOIN book_members m ON m.book_id = s.book_id AND m.member_id = s.member_id WHERE s.book_id = ${bookId}`);
      if (row) return row[0];
    }
  } catch {
    // A database from before household sharing has no members.
  }
  return null;
}

async function whoOf(db: Db, event: AuditEvent, books: readonly string[]): Promise<string | null> {
  const author = event.payload.syncAuthor;
  if (event.src === 'sync' && typeof author === 'string' && author) return (await memberName(db, author, books)) ?? author;
  return myName(db, books);
}

const noun = (title: string): string =>
  title
    .replace(/ edited$/, ' edit')
    .replace(/ deleted$/, ' delete')
    .replace(/ added$/, ' add')
    .replace(/ paid$/, ' payment')
    .replace(/ archived$/, ' archive')
    .replace(/ moved to .*$/, ' move');

const NO_LINE = Symbol('no line');

/** One event as a line, or `NO_LINE` when it is not one the page lists (a row that is gone, or one the app made on its own). */
async function lineOf(db: Db, ws: WorkspaceContext, event: AuditEvent, undone: ReadonlySet<string>): Promise<ActivityLine | typeof NO_LINE> {
  const base = { id: event.id, at: event.at, changes: [] as ActivityChange[], undo: null as ActivityUndo | null, transactionId: null as string | null };
  const done = undone.has(event.id);

  if (event.src === 'account') {
    return { ...base, kind: 'rename', group: 'accounts', title: 'Account renamed', subtitle: typeof event.payload.name === 'string' ? `Now ${event.payload.name}` : '', who: null, state: 'cannot' };
  }
  if (event.src === 'book') {
    const name = typeof event.payload.name === 'string' ? event.payload.name : '';
    return { ...base, kind: 'other', group: 'accounts', title: 'Workspace deleted', subtitle: name, who: null, state: 'safety' };
  }
  if (event.op === 'archive') {
    const [account] = await db.values<[string, string | null, string]>(sql`SELECT name, archived_at, kind FROM accounts WHERE id = ${event.entityId} AND workspace_id = ${ws.workspaceId}`);
    if (!account) return NO_LINE;
    const sold = (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'asset_sales'`)).length > 0
      && (await db.values(sql`SELECT 1 FROM asset_sales WHERE account_id = ${event.entityId} LIMIT 1`)).length > 0;
    const live = account[1] === null;
    const state: ActivityState = done ? 'undone' : live ? 'changed' : sold ? 'cannot' : 'open';
    return { ...base, kind: 'other', group: 'accounts', title: `${account[0]} archived`, subtitle: '', who: null, state, undo: state === 'open' ? { kind: 'unarchive', accountId: event.entityId } : null };
  }

  // Everything below is about a transaction.
  const txId = event.entityId;
  if (event.src === 'sync') {
    if (await eventPostingOfTx(db, txId)) return NO_LINE;
    if (event.op === 'void' && (await hasReplacement(db, txId))) return NO_LINE;
  }
  const now = await versionOf(db, ws, txId);
  if (!now) return NO_LINE;
  if (now.externalRef?.startsWith('before-app:')) return NO_LINE;
  const who = await whoOf(db, event, now.books);
  const gone = now.status !== 'posted';
  const tail = async (): Promise<boolean> => gone || (await hasReplacement(db, txId));

  const op = event.src === 'sync' ? (event.op === 'void' ? 'delete' : typeof event.payload.replacesTransactionId === 'string' ? 'edit' : 'create') : event.op;
  const adjusting = op === 'adjust';

  if (op === 'delete') {
    // A row that was deleted and is not void any more has been put back by other means.
    if (now.status !== 'void') return NO_LINE;
    const state: ActivityState = done ? 'undone' : 'open';
    return { ...base, kind: 'delete', group: 'transactions', title: `${now.description} deleted`, subtitle: figureLine(now), who, state, undo: state === 'open' ? { kind: 'delete', transactionId: txId } : null };
  }

  if (op === 'create' || op === 'payment' || adjusting) {
    // A statement check's own balancing row: it stands for the statement's figures, so voiding it alone would leave the check saying reconciled.
    const checked = adjusting && event.payload.statement === true;
    let title = checked
      ? `${typeof event.payload.accountName === 'string' ? `${event.payload.accountName} ` : ''}statement adjusted`
      : adjusting ? `${typeof event.payload.accountName === 'string' ? `${event.payload.accountName} ` : ''}${now.description === 'Counted cash' ? 'counted' : 'balance adjusted'}` : `${now.description} added`;
    if (op === 'payment') {
      const [bill] = await db.values<[string]>(sql`SELECT name FROM expense_templates WHERE id = ${String(event.payload.templateId ?? now.templateId ?? '')}`);
      title = `${bill?.[0] ?? now.description} paid`;
    }
    const open = !done && !(await tail());
    const state: ActivityState = done ? 'undone' : open ? (checked ? 'cannot' : 'open') : 'changed';
    return {
      ...base,
      kind: op === 'payment' ? 'payment' : 'create',
      group: 'transactions',
      title,
      subtitle: figureLine(now),
      who,
      state,
      undo: open && !checked ? { kind: 'remove', transactionId: txId } : null,
      transactionId: gone ? null : txId,
    };
  }

  if (op === 'edit') {
    const oldId = typeof event.payload.replaces === 'string' ? event.payload.replaces : typeof event.payload.replacesTransactionId === 'string' ? event.payload.replacesTransactionId : null;
    const was = oldId ? await versionOf(db, ws, oldId) : null;
    if (!oldId || !was) return NO_LINE;
    const moved = now.books.length > 0 && now.books.join() !== was.books.join();
    const changes = diffOf(was, now);
    const open = !done && !(await tail());
    if (moved) {
      const to = await bookName(db, now.books[0]);
      const from = await bookName(db, was.books[0]);
      const undoable = open && was.books.length === 1;
      const state: ActivityState = done ? 'undone' : undoable ? 'open' : open ? 'cannot' : 'changed';
      return {
        ...base,
        kind: 'move',
        group: 'transactions',
        title: `${now.description} moved to ${to}`,
        subtitle: from ? `From ${from}` : figureLine(now),
        who,
        changes: [{ field: 'Workspace', from, to }, ...changes],
        state,
        undo: undoable ? { kind: 'move', items: [{ newId: txId, oldId }], toBookId: was.books[0]! } : null,
        transactionId: gone ? null : txId,
      };
    }
    const state: ActivityState = done ? 'undone' : open ? 'open' : 'changed';
    return {
      ...base,
      kind: 'edit',
      group: 'transactions',
      title: `${now.description} edited`,
      subtitle: summaryOf(changes) || figureLine(now),
      who,
      changes,
      state,
      undo: open ? { kind: 'edit', newId: txId, oldId } : null,
      transactionId: gone ? null : txId,
    };
  }
  return NO_LINE;
}

/** Moves made together (a selection moved to a workspace) read as one line. */
const TOGETHER_MS = 3000;

function together(prev: ActivityLine, next: ActivityLine): boolean {
  if (prev.kind !== 'move' || next.kind !== 'move' || prev.state !== next.state || prev.who !== next.who) return false;
  if (prev.changes[0]?.to !== next.changes[0]?.to || prev.changes[0]?.from !== next.changes[0]?.from) return false;
  return Math.abs(Date.parse(prev.at) - Date.parse(next.at)) <= TOGETHER_MS;
}

/** The group's line: one title, and a row per purchase moved. */
function merge(prev: ActivityLine, next: ActivityLine, members: ActivityChange[]): ActivityLine {
  const workspace = prev.changes[0]!;
  const nameOf = (line: ActivityLine) => line.title.replace(/ moved to .*$/, '');
  const rows = [...members, { field: nameOf(next), from: workspace.from, to: workspace.to }];
  return {
    ...prev,
    title: `${rows.length} purchases moved to ${workspace.to}`,
    subtitle: workspace.from ? `From ${workspace.from}` : '',
    changes: rows,
    transactionId: null,
    undo: prev.undo?.kind === 'move' && next.undo?.kind === 'move' ? { kind: 'move', items: [...prev.undo.items, ...next.undo.items], toBookId: prev.undo.toBookId } : null,
  };
}

export interface ActivityOptions {
  /** How many lines; defaults to 100. */
  limit?: number;
  /** One kind, or `transactions` / `accounts` for a whole segment; every line when absent. */
  kind?: ActivityKind | ActivityGroup | 'all';
}

function undoneTargets(events: readonly AuditEvent[]): Set<string> {
  const out = new Set<string>();
  for (const event of events) if (event.src === 'mark' && event.op === 'undo' && typeof event.payload.target === 'string') out.add(event.payload.target);
  return out;
}

async function linesOf(db: Db, ws: WorkspaceContext, options: ActivityOptions): Promise<ActivityLine[]> {
  const limit = Math.max(1, options.limit ?? 100);
  const wanted = options.kind ?? 'all';
  const events = await eventsOf(db, ws);
  const undone = undoneTargets(events);
  // The purchases a moved-together line stands for, by the line that stands for them.
  const members = new Map<ActivityLine, ActivityChange[]>();
  const out: ActivityLine[] = [];
  for (const event of events) {
    let line: ActivityLine | typeof NO_LINE;
    if (event.src === 'mark' && event.op === 'undo') {
      const title = typeof event.payload.title === 'string' ? event.payload.title : 'Undone';
      line = {
        id: event.id,
        at: event.at,
        kind: 'other',
        group: event.payload.group === 'accounts' ? 'accounts' : 'transactions',
        title,
        subtitle: typeof event.payload.subtitle === 'string' ? event.payload.subtitle : '',
        who: null,
        changes: [],
        state: 'log',
        undo: null,
        transactionId: null,
      };
    } else {
      line = await lineOf(db, ws, event, undone);
    }
    if (line === NO_LINE) continue;
    if (wanted !== 'all' && wanted !== line.group && wanted !== line.kind) continue;
    const prev = out[out.length - 1];
    if (prev && together(prev, line)) {
      const own = members.get(prev) ?? [{ field: prev.title.replace(/ moved to .*$/, ''), from: prev.changes[0]!.from, to: prev.changes[0]!.to }];
      const grouped = merge(prev, line, own);
      members.set(grouped, grouped.changes);
      out[out.length - 1] = grouped;
      continue;
    }
    if (out.length >= limit) break;
    out.push(line);
  }
  return out;
}

/** The most recent actions, newest first. */
export function activityOf(database: Database, ws: WorkspaceContext, options: ActivityOptions = {}): Promise<ActivityLine[]> {
  return linesOf(database.db, ws, options);
}

/** One line by its id, as the detail page shows it. */
export async function activityLine(database: Database, ws: WorkspaceContext, id: string): Promise<ActivityLine | null> {
  return (await linesOf(database.db, ws, { limit: 2000 })).find((line) => line.id === id) ?? null;
}

// ---------------------------------------------------------------------------------------------------------- undo

/** A saved transaction as the input that would post it again: the same lines at the same rates, day, words and flags. */
export async function inputOfTx(tx: Db, ws: WorkspaceContext, id: string): Promise<PostTransactionInput> {
  const v = await versionOf(tx, ws, id);
  if (!v) throw new ActivityError('That transaction is not here any more');
  const ratesToBase: Record<string, number> = {};
  for (const line of v.lines) ratesToBase[line.currency] = line.rate;
  const extras = await extrasForTx(tx, ws, id);
  const [placed] = (await dayOrderExists(tx)) ? await tx.values<[number | null]>(sql`SELECT day_order FROM transactions WHERE id = ${id}`) : [];
  const [typed] = (await exactExists(tx)) ? await tx.values<[number | null]>(sql`SELECT exact_hundredths FROM transactions WHERE id = ${id}`) : [];
  const [bill] = (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bill_payments'`)).length > 0
    ? await tx.values<[string]>(sql`SELECT bill_month FROM bill_payments WHERE transaction_id = ${id}`)
    : [];
  const excluded = await excludedLinesTx(tx, id);
  // A past purchase on a money account (its balancing pair, found by the ref and the Before the app line, voided or not)
  // goes back as one, so Undo of a delete or of an edit that changed the mark puts the mark back too.
  const [past] = await tx.values<[number]>(sql`
    SELECT 1 FROM transactions t JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id
    WHERE t.workspace_id = ${ws.workspaceId} AND t.external_ref = ${`before-app:${id}`} AND a.system_key = 'before_the_app' LIMIT 1`);
  // A card purchase keeps following its own settlement; only a purchase off a card says the mark outright.
  const [card] = await tx.values<[number]>(sql`SELECT 1 FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${id} AND a.subtype = 'credit_card' LIMIT 1`);
  const lines: PostingLine[] = v.lines.map((line) => ({
    accountId: line.accountId,
    amountMinor: line.amountMinor,
    currency: line.currency,
    amountBaseMinor: line.baseMinor,
    ...(line.memo ? { memo: line.memo } : {}),
    ...(line.spendCategoryId ? { spendCategoryId: line.spendCategoryId } : {}),
  }));
  return {
    occurredOn: v.occurredOn,
    description: v.description,
    lines,
    ratesToBase,
    source: v.source as PostTransactionInput['source'],
    originalCurrency: v.originalCurrency,
    originalAmountMinor: v.originalAmountMinor,
    mcc: v.mcc,
    cardId: v.cardId,
    eventId: v.eventId,
    templateId: v.templateId,
    billMonth: bill?.[0] ?? null,
    channel: extras?.channel ?? null,
    excludedFromReport: extras?.excluded ?? false,
    excludedParts: [...excluded],
    dayOrder: placed?.[0] ?? null,
    exactHundredths: typed?.[0] ?? null,
    ...(card === undefined || past !== undefined ? { pastPurchase: past !== undefined } : {}),
  };
}

const STALE: Record<string, string> = {
  changed: 'This was changed again since, so it can no longer be undone from here.',
  undone: 'This was already undone.',
  cannot: 'Nothing earlier was kept for this, so it cannot be undone.',
  safety: 'A deleted workspace cannot be undone here.',
  log: 'This line is an undo already.',
};

/**
 * Undoes one line of the list, inside one database transaction: the earlier version is written back through the ledger's
 * own doors (so every balance stays balanced and every guard of a normal edit applies, a shared workspace's included),
 * and an `undo` row is left, which is the next line of the list. A refusal from the ledger is thrown as it is, with
 * nothing changed.
 */
export async function undoActivity(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const line = (await linesOf(tx, ws, { limit: 2000 })).find((candidate) => candidate.id === id);
    if (!line) throw new ActivityError('That line is not in the list any more');
    if (line.state !== 'open' || !line.undo) throw new ActivityError(STALE[line.state] ?? 'This cannot be undone.');
    await applyUndo(tx, ws, line.undo);
    await tx.insert(auditLog).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      action: 'undo',
      entity: 'activity',
      entityId: id,
      payloadJson: JSON.stringify({ target: id, title: `Undone: ${noun(line.title)}`, subtitle: line.subtitle, group: line.group }),
      createdAt: new Date().toISOString(),
    });
  });
}

async function applyUndo(tx: Tx, ws: WorkspaceContext, undo: ActivityUndo): Promise<void> {
  switch (undo.kind) {
    case 'edit':
      await replaceTransactionTx(tx, ws, undo.newId, await inputOfTx(tx, ws, undo.oldId));
      return;
    case 'move':
      for (const item of undo.items) await replaceTransactionTx(tx, ws, item.newId, { ...(await inputOfTx(tx, ws, item.oldId)), moveToBook: true, toBookId: undo.toBookId });
      return;
    case 'remove':
      await voidTransactionTx(tx, ws, undo.transactionId);
      return;
    case 'delete': {
      const input = await inputOfTx(tx, ws, undo.transactionId);
      const was = await versionOf(tx, ws, undo.transactionId);
      const restored = await postTransactionTx(tx, ws, { ...input, ...(was && was.books.length > 1 ? { acrossBooks: true } : {}) });
      // A transfer has no category to file it by: it goes back to the workspace it was filed in.
      if (was && was.books.length === 1 && !was.lines.some(isCategory)) await fileTransferTx(tx, ws, restored, was.books[0]!);
      return;
    }
    case 'unarchive':
      await unarchiveAccountTx(tx, ws, undo.accountId);
      return;
  }
}
