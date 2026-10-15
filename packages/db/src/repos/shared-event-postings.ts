import { MoneyError, type MyLines, myExpenseLines, mySettlementLines, type PaidFromAccount, SharedEventError, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { ensureSystemAccountTx } from './accounts';
import { eventOnlyExists } from './event-only';
import { postTransactionTx, type PostTransactionInput, replaceTransactionTx, voidTransactionTx } from './ledger';
import { type EventBookRow, eventBookTx, expenseRecordTx, settlementRecordTx } from './shared-event-records';

/*
 * What a shared event's records put in this phone's own books (shared events §5) — the way `postTransferSideTx` follows
 * a transfer between partners. One function brings this phone's transaction for one record in line with it: posted,
 * replaced (`replaceTransactionTx`, which carries a card purchase's card, MCC, channel, photos, statement match and
 * points), voided, or left waiting with the reason why (`event_postings.unposted`). The lines are core's
 * (`myExpenseLines`, `mySettlementLines`); this reads the record, this phone's paying account and the day's rates
 * (as `rateOf` in transfers.ts does), and writes through the ledger's doors.
 *
 * The share category is this phone's own copy of the event's category: an expense account in no workspace book, so the
 * posting has no `book_transactions` row and is in no workspace (§5.1). The account a person paid from never syncs; it
 * is kept here, in `event_postings`, with its own-currency figure when that differs (ruling R5).
 */

export type EventPostingKind = 'expense' | 'settlement';
export type EventUnposted = 'choose-account' | 'no-rate' | 'malformed';

/** Facts about a purchase this phone recorded itself, set on its first posting only; a replacement carries them. */
export interface EventPostingExtras {
  cardId?: string | null;
  mcc?: string | null;
  channel?: 'online' | 'offline' | null;
  photoIds?: string[];
}

interface PostingRow {
  transactionId: string | null;
  accountId: string | null;
  accountAmountMinor: number | null;
}

const wsOf = (book: EventBookRow): WorkspaceContext => ({ workspaceId: book.workspaceId, baseCurrency: book.baseCurrency });

async function ensurePostingTx(tx: Db, bookId: string, recordId: string, kind: EventPostingKind): Promise<PostingRow> {
  await tx.run(sql`INSERT INTO event_postings (book_id, record_id, kind) VALUES (${bookId}, ${recordId}, ${kind}) ON CONFLICT (book_id, record_id) DO NOTHING`);
  const [row] = await tx.values<[string | null, string | null, number | null]>(
    sql`SELECT transaction_id, account_id, account_amount_minor FROM event_postings WHERE book_id = ${bookId} AND record_id = ${recordId}`,
  );
  return { transactionId: row![0], accountId: row![1], accountAmountMinor: row![2] === null ? null : Number(row![2]) };
}

async function setUnpostedTx(tx: Db, bookId: string, recordId: string, reason: EventUnposted | null): Promise<void> {
  await tx.run(sql`UPDATE event_postings SET unposted = ${reason} WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/**
 * The account this person paid a record from or received it into, and what it moved in its own currency (null when that
 * is the record's own currency). Local only (ruling R5): written when this phone records, settles or takes over.
 */
export async function setPaidFromTx(tx: Db, bookId: string, recordId: string, kind: EventPostingKind, account: { accountId: string; amountMinor: number | null } | null): Promise<void> {
  await ensurePostingTx(tx, bookId, recordId, kind);
  await tx.run(sql`
    UPDATE event_postings SET account_id = ${account?.accountId ?? null}, account_amount_minor = ${account?.amountMinor ?? null}
    WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/**
 * This phone's own copy of an event category (or of "no category", keyed ''): an expense account filed in no book, made
 * the first time a record needs it. `earnCategoryId` is the workspace category a card earns by on these purchases
 * (ruling R12): kept the first time one is given.
 */
export async function ensureShareAccountTx(tx: Db, book: EventBookRow, categoryId: string | null, earnCategoryId: string | null = null): Promise<string> {
  const key = categoryId ?? '';
  const [found] = await tx.values<[string, string | null]>(sql`SELECT account_id, earn_category_id FROM event_category_accounts WHERE book_id = ${book.bookId} AND category_id = ${key}`);
  if (found) {
    if (earnCategoryId && !found[1]) await tx.run(sql`UPDATE event_category_accounts SET earn_category_id = ${earnCategoryId} WHERE book_id = ${book.bookId} AND category_id = ${key}`);
    return found[0];
  }
  const [named] = categoryId ? await tx.values<[string, string | null]>(sql`SELECT name, icon FROM event_categories WHERE book_id = ${book.bookId} AND id = ${categoryId}`) : [];
  const id = uuidv7();
  // Straight into `accounts`, never through `createAccountTx`, which files every category into a book.
  await tx.run(sql`
    INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
    VALUES (${id}, ${book.workspaceId}, NULL, 'expense', 'category', ${named?.[0] ?? 'Shared spending'}, ${named?.[1] ?? null}, NULL, 'derived', NULL, 0, NULL, ${new Date().toISOString()})`);
  await tx.run(sql`INSERT INTO event_category_accounts (book_id, category_id, account_id, earn_category_id) VALUES (${book.bookId}, ${key}, ${id}, ${earnCategoryId})`);
  return id;
}

/** Not an account id: what the lines name the share category by before it exists (never written). */
const SHARE_PENDING = 'share-category-pending';

async function shareAccountOfTx(tx: Db, bookId: string, categoryId: string | null): Promise<string | null> {
  const [row] = await tx.values<[string]>(sql`SELECT account_id FROM event_category_accounts WHERE book_id = ${bookId} AND category_id = ${categoryId ?? ''}`);
  return row?.[0] ?? null;
}

async function earnCategoryTx(tx: Db, bookId: string, categoryId: string | null): Promise<string | null> {
  const [row] = await tx.values<[string | null]>(sql`SELECT earn_category_id FROM event_category_accounts WHERE book_id = ${bookId} AND category_id = ${categoryId ?? ''}`);
  return row?.[0] ?? null;
}

/*
 * The paying account as it is now, archived or not: it was chosen when the record was made, and archiving it later must
 * not take the payment off it when a friend edits the split or the category (Review Focus 5). Only a pick is limited to
 * open accounts, and that is the screen's.
 */
async function accountTx(tx: Db, accountId: string): Promise<{ currency: string; subtype: string } | null> {
  const [row] = await tx.values<[string | null, string]>(sql`SELECT currency, subtype FROM accounts WHERE id = ${accountId}`);
  return row && row[0] ? { currency: row[0], subtype: row[1] } : null;
}

/** Units of `base` per one unit of `currency` on or before `on`, else the latest known; null when none. As transfers.ts reads it. */
export async function rateToBaseTx(tx: Db, currency: string, base: string, on: string): Promise<number | null> {
  if (currency === base) return 1;
  const [row] = await tx.values<[number]>(sql`
    SELECT rate FROM fx_rates WHERE from_currency = ${currency} AND to_currency = ${base}
    ORDER BY (on_date <= ${on}) DESC, CASE WHEN on_date <= ${on} THEN on_date END DESC, on_date DESC LIMIT 1`);
  const rate = row ? Number(row[0]) : NaN;
  return rate > 0 && Number.isFinite(rate) ? rate : null;
}

async function ratesForTx(tx: Db, base: string, currencies: readonly string[], on: string): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  for (const currency of new Set(currencies)) {
    if (currency === base) continue;
    const rate = await rateToBaseTx(tx, currency, base, on);
    if (rate === null) return null;
    out[currency] = rate;
  }
  return out;
}

/**
 * Whether a posted transaction already reads as `input`: date, words, original pair and every line — its account,
 * amount, currency and spend category. Nothing to replace then. The currency is part of a line: the exchange account
 * holds one line per currency, so a record moved from euro to dollars with the same figures has the same accounts and
 * amounts and differs only there.
 */
async function samePostingTx(tx: Db, transactionId: string, input: PostTransactionInput): Promise<boolean> {
  const [head] = await tx.values<[string, string, string | null, number | null, string | null]>(
    sql`SELECT occurred_on, description, original_currency, original_amount_minor, event_id FROM transactions WHERE id = ${transactionId}`,
  );
  if (!head || head[0] !== input.occurredOn || head[1] !== input.description.trim() || head[4] !== (input.eventId ?? null)) return false;
  if (head[2] !== (input.originalCurrency ?? null) || (head[3] === null ? null : Number(head[3])) !== (input.originalAmountMinor ?? null)) return false;
  const entries = await tx.values<[string, number, string, string | null]>(
    sql`SELECT account_id, amount_minor, currency, spend_category_id FROM entries WHERE transaction_id = ${transactionId}`,
  );
  const key = (lines: [string, number, string, string | null][]) => lines.map((line) => line.join('|')).sort().join(',');
  return (
    key(entries.map(([account, minor, currency, spend]) => [account, Number(minor), currency, spend])) ===
    key(input.lines.map((line) => [line.accountId, line.amountMinor, line.currency, line.spendCategoryId ?? null]))
  );
}

interface Built {
  lines: MyLines;
  occurredOn: string;
  description: string;
  original: { currency: string; amountMinor: number } | null;
}

async function expenseBuiltTx(tx: Db, book: EventBookRow, recordId: string, posting: PostingRow): Promise<Built | null> {
  const record = await expenseRecordTx(tx, book.bookId, recordId);
  if (!record) return null;
  const exchange = await ensureSystemAccountTx(tx, wsOf(book), 'currency_exchange');
  // The share category is made only when a line lands on it: a record this person has no part in leaves no category
  // behind. Until then the lines name it by a stand-in, swapped for the real account below.
  const known = await shareAccountOfTx(tx, book.bookId, record.categoryId);
  const share = known ?? SHARE_PENDING;
  let paidFrom: PaidFromAccount | null = null;
  let original: Built['original'] = null;
  // Ruling R6: "I paid" posts only from an account this phone holds, on a record that names this member as its payer's.
  if (record.payerPersonId === book.me && record.payerMemberId === book.me && posting.accountId) {
    const account = await accountTx(tx, posting.accountId);
    if (account) {
      const same = account.currency === record.currency;
      const charged = same ? record.amountMinor : posting.accountAmountMinor;
      if (charged !== null) {
        const card = account.subtype === 'credit_card';
        paidFrom = { accountId: posting.accountId, currency: account.currency, chargedMinor: charged, spendCategoryId: card ? ((await earnCategoryTx(tx, book.bookId, record.categoryId)) ?? share) : null };
        if (!same) original = { currency: record.currency, amountMinor: record.amountMinor };
      }
    }
  }
  let lines = myExpenseLines({ expense: record, eventCurrency: book.currency, me: book.me, accounts: { shareAccountId: share, eventBalanceAccountId: book.balanceAccountId, exchangeAccountId: exchange }, paidFrom });
  if (!known && lines.kind === 'lines' && lines.lines.some((line) => line.accountId === SHARE_PENDING || line.spendCategoryId === SHARE_PENDING)) {
    const made = await ensureShareAccountTx(tx, book, record.categoryId);
    lines = {
      kind: 'lines',
      lines: lines.lines.map((line) => ({
        ...line,
        accountId: line.accountId === SHARE_PENDING ? made : line.accountId,
        ...(line.spendCategoryId === SHARE_PENDING ? { spendCategoryId: made } : {}),
      })),
    };
  }
  const [category] = record.categoryId ? await tx.values<[string]>(sql`SELECT name FROM event_categories WHERE book_id = ${book.bookId} AND id = ${record.categoryId}`) : [];
  return { lines, occurredOn: record.occurredOn, description: record.note?.trim() || category?.[0] || 'Shared spending', original };
}

async function settlementBuiltTx(tx: Db, book: EventBookRow, recordId: string, posting: PostingRow): Promise<Built | null> {
  const record = await settlementRecordTx(tx, book.bookId, recordId);
  if (!record) return null;
  const exchange = await ensureSystemAccountTx(tx, wsOf(book), 'currency_exchange');
  const mine = (record.fromPersonId === book.me && record.fromMemberId === book.me) || (record.toPersonId === book.me && record.toMemberId === book.me);
  let account: { accountId: string; currency: string; amountMinor: number } | null = null;
  if (mine && posting.accountId) {
    const held = await accountTx(tx, posting.accountId);
    const amountMinor = held ? (held.currency === book.currency ? record.amountMinor : posting.accountAmountMinor) : null;
    if (held && amountMinor !== null) account = { accountId: posting.accountId, currency: held.currency, amountMinor };
  }
  const lines = mySettlementLines({ settlement: record, eventCurrency: book.currency, me: book.me, eventBalanceAccountId: book.balanceAccountId, exchangeAccountId: exchange, account });
  const names = new Map(await tx.values<[string, string]>(sql`SELECT id, name FROM event_people WHERE book_id = ${book.bookId}`));
  return { lines, occurredOn: record.occurredOn, description: `${names.get(record.fromPersonId) ?? 'Someone'} paid ${names.get(record.toPersonId) ?? 'someone'}`, original: null };
}

/**
 * Brings this phone's transaction for one record in line with it. `author` is the member whose change this follows —
 * the authority view's for a peer's op, null for this phone's own write — and is what "Changed by Andi" reads.
 */
export async function postEventRecordTx(tx: Tx, bookId: string, kind: EventPostingKind, recordId: string, author: string | null, extras: EventPostingExtras = {}): Promise<void> {
  const book = await eventBookTx(tx, bookId);
  if (!book) return;
  const ws = wsOf(book);
  const posting = await ensurePostingTx(tx, bookId, recordId, kind);
  const [status] = posting.transactionId ? await tx.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${posting.transactionId}`) : [];
  const posted = status?.[0] === 'posted' ? posting.transactionId : null;
  const voidPosted = async () => {
    if (posted) await voidTransactionTx(tx, ws, posted, {}, author ?? undefined);
  };
  let built: Built | null;
  try {
    built = kind === 'expense' ? await expenseBuiltTx(tx, book, recordId, posting) : await settlementBuiltTx(tx, book, recordId, posting);
  } catch (error) {
    if (error instanceof SharedEventError || error instanceof MoneyError) return setUnpostedTx(tx, bookId, recordId, 'malformed');
    throw error;
  }
  if (!built) return setUnpostedTx(tx, bookId, recordId, 'malformed');
  if (built.lines.kind === 'needs-account') {
    await voidPosted();
    return setUnpostedTx(tx, bookId, recordId, 'choose-account');
  }
  if (built.lines.kind === 'none') {
    await voidPosted();
    return setUnpostedTx(tx, bookId, recordId, null);
  }
  const rates = await ratesForTx(tx, book.baseCurrency, built.lines.lines.map((line) => line.currency), built.occurredOn);
  if (!rates) return setUnpostedTx(tx, bookId, recordId, 'no-rate');
  // The trip balance is in the event currency; while it is still empty it follows the event's (R8), so a currency this
  // phone changed before it heard of the first expense never leaves it in the wrong one.
  await tx.run(sql`
    UPDATE accounts SET currency = ${book.currency}
    WHERE id = ${book.balanceAccountId} AND currency <> ${book.currency} AND NOT EXISTS (SELECT 1 FROM entries WHERE account_id = ${book.balanceAccountId})`);
  const input: PostTransactionInput = {
    occurredOn: built.occurredOn,
    description: built.description,
    lines: built.lines.lines,
    ratesToBase: rates,
    eventId: book.eventId,
    originalCurrency: built.original?.currency ?? null,
    originalAmountMinor: built.original?.amountMinor ?? null,
    ...(author ? { syncAuthor: author } : {}),
  };
  if (posted) {
    if (await samePostingTx(tx, posted, input)) return setUnpostedTx(tx, bookId, recordId, null);
    const replaced = await replaceTransactionTx(tx, ws, posted, input);
    // "Changed by Andi" (spec §7): someone else's change replaced it. This phone's own edit clears it.
    const changedBy = author !== null && author !== book.me ? author : null;
    await tx.run(sql`UPDATE event_postings SET transaction_id = ${replaced}, unposted = NULL, changed_by = ${changedBy} WHERE book_id = ${bookId} AND record_id = ${recordId}`);
    return;
  }
  // A first posting changed nothing that was here before, whoever recorded it (0069: changed_by is the member whose
  // change last *replaced* the transaction); who recorded it is the record's own `recorded_by`.
  const id = await postTransactionTx(tx, ws, { ...input, cardId: extras.cardId ?? null, mcc: extras.mcc ?? null, channel: extras.channel ?? null, ...(extras.photoIds ? { photoIds: extras.photoIds } : {}) });
  await tx.run(sql`UPDATE event_postings SET transaction_id = ${id}, unposted = NULL, changed_by = NULL WHERE book_id = ${bookId} AND record_id = ${recordId}`);
}

/** The event's name, dates and Done follow into the local `events` row and the trip balance's name (and, while it is empty, its currency). */
export async function followSharedEventTx(tx: Db, bookId: string): Promise<void> {
  const book = await eventBookTx(tx, bookId);
  if (!book) return;
  await tx.run(sql`UPDATE events SET name = ${book.name}, starts_on = ${book.startsOn}, ends_on = ${book.endsOn}, finished_at = ${book.finishedAt} WHERE id = ${book.eventId}`);
  await tx.run(sql`UPDATE accounts SET name = ${book.name} WHERE id = ${book.balanceAccountId}`);
  const [used] = await tx.values(sql`SELECT 1 FROM entries WHERE account_id = ${book.balanceAccountId} LIMIT 1`);
  if (!used) await tx.run(sql`UPDATE accounts SET currency = ${book.currency} WHERE id = ${book.balanceAccountId}`);
}

/** What one applied (or locally written) op of an event's book means for this phone's own books. */
export async function followEventOpTx(tx: Tx, bookId: string, entity: string, id: string, author: string | null): Promise<void> {
  if (entity === 'shared_event') return followSharedEventTx(tx, bookId);
  if (entity === 'event_expense' || entity === 'event_expense_detail') return postEventRecordTx(tx, bookId, 'expense', id, author);
  if (entity === 'event_settlement') return postEventRecordTx(tx, bookId, 'settlement', id, author);
  if (entity === 'event_category') {
    await tx.run(sql`
      UPDATE accounts SET name = (SELECT name FROM event_categories WHERE book_id = ${bookId} AND id = ${id})
      WHERE id = (SELECT account_id FROM event_category_accounts WHERE book_id = ${bookId} AND category_id = ${id})
        AND EXISTS (SELECT 1 FROM event_categories WHERE book_id = ${bookId} AND id = ${id})`);
  }
}

/**
 * The records whose derived transaction reads a person's or a category's row besides its own (controller ruling c): a
 * settle-up's description names both people ("Andi paid Rina"); an expense without a note is described by its
 * category's name. A rename brings each along, so no description goes stale. Live records only: a voided one's
 * transaction is void already.
 */
export async function recordsReadingTx(tx: Db, bookId: string, entity: string, id: string): Promise<{ kind: EventPostingKind; recordId: string }[]> {
  if (entity === 'event_person') {
    const rows = await tx.values<[string]>(sql`
      SELECT id FROM event_settlements WHERE book_id = ${bookId} AND voided_at IS NULL AND (from_person_id = ${id} OR to_person_id = ${id}) ORDER BY id`);
    return rows.map(([recordId]) => ({ kind: 'settlement', recordId }));
  }
  if (entity === 'event_category') {
    const rows = await tx.values<[string]>(sql`
      SELECT x.id FROM event_expenses x JOIN event_expense_details d ON d.book_id = x.book_id AND d.id = x.id
      WHERE x.book_id = ${bookId} AND x.voided_at IS NULL AND d.category_id = ${id} AND trim(coalesce(d.note, '')) = '' ORDER BY x.id`);
    return rows.map(([recordId]) => ({ kind: 'expense', recordId }));
  }
  return [];
}

/**
 * Tries again every record this phone left waiting for a rate, or for a detail that had not arrived: after a rate is
 * saved and after each sync of an event's book. Returns how many now post.
 */
export async function retryUnpostedEventRecords(database: Database, bookId?: string): Promise<number> {
  if (!(await eventOnlyExists(database.db))) return 0;
  const rows = await database.db.values<[string, string, string]>(
    bookId === undefined
      ? sql`SELECT book_id, record_id, kind FROM event_postings WHERE unposted IN ('no-rate', 'malformed') ORDER BY book_id, record_id`
      : sql`SELECT book_id, record_id, kind FROM event_postings WHERE unposted IN ('no-rate', 'malformed') AND book_id = ${bookId} ORDER BY record_id`,
  );
  let posted = 0;
  for (const [book, record, kind] of rows) {
    // One record the ledger still refuses (a peer's date it cannot read) stays waiting, and never holds up the rest.
    const done = await database
      .transaction(async (tx) => {
        await postEventRecordTx(tx, book, kind as EventPostingKind, record, null);
        const [row] = await tx.values<[string | null]>(sql`SELECT unposted FROM event_postings WHERE book_id = ${book} AND record_id = ${record}`);
        return row?.[0] === null;
      })
      .catch(() => false);
    if (done) posted += 1;
  }
  return posted;
}

/** The currencies and days the records waiting for a rate need, so the app can fetch them (each pair once). */
export async function eventRatesWanted(database: Database): Promise<{ currency: string; onDate: string }[]> {
  if (!(await eventOnlyExists(database.db))) return [];
  const rows = await database.db.values<[string, string, string, string | null]>(
    sql`SELECT book_id, record_id, kind, account_id FROM event_postings WHERE unposted = 'no-rate' ORDER BY book_id, record_id`,
  );
  const wanted = new Map<string, { currency: string; onDate: string }>();
  for (const [bookId, recordId, kind, accountId] of rows) {
    const book = await eventBookTx(database.db, bookId);
    if (!book) continue;
    const record = kind === 'expense' ? await expenseRecordTx(database.db, bookId, recordId).catch(() => null) : await settlementRecordTx(database.db, bookId, recordId);
    if (!record) continue;
    const currencies = [book.currency, ...('currency' in record ? [record.currency] : [])];
    if (accountId) {
      const account = await accountTx(database.db, accountId);
      if (account) currencies.push(account.currency);
    }
    for (const currency of currencies) {
      if ((await rateToBaseTx(database.db, currency, book.baseCurrency, record.occurredOn)) !== null) continue;
      wanted.set(`${currency}|${record.occurredOn}`, { currency, onDate: record.occurredOn });
    }
  }
  return [...wanted.values()];
}
