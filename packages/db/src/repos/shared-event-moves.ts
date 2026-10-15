import { convertMinor, expenseInEvent, rateString, SharedEventError, splitJsonOf, uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { BookReadOnlyError, withCapture } from '../sync/capture';
import { listSetCategories } from './category-sets';
import { listEventItems } from './event-items';
import { eventOf } from './event-scope';
import { listTransactions } from './ledger';
import { linkSharedItem, saveSharedItem } from './shared-event-plan';
import { ensureShareAccountTx, postEventRecordTx, rateToBaseTx } from './shared-event-postings';
import { type EventBookRow, expenseRecordTx } from './shared-event-records';
import { openSharedEventTx, SharedEventDbError } from './shared-event-writes';

/*
 * Moving spending into a shared event (shared events §6, D2). A purchase tagged into a shared event leaves its workspace:
 * only this person's share of a shared event is their spending, and a purchase moved in is all theirs — an expense paid
 * by this person, from the account it was paid from, split to them alone. The transaction is not posted again: it
 * becomes the expense's own derived transaction, replaced in place (`replaceTransactionTx`), so it keeps its card, MCC,
 * channel, photos, posting date, statement match and points (Review Focus 3), and its card earns by the category it
 * was filed under (R12).
 *
 * Every message names things and never says "you" (the owner's rule).
 */

export interface MoveRefusal {
  transactionId: string;
  why: string;
}

const NOT_MOVABLE = 'Only a purchase from one account under one category moves into a shared event';

/*
 * The money side of a purchase: an account money is paid from. Never what someone owes or is owed (a receivable or a
 * payable is a debt, not a purse) and never a trip balance, which is already a shared event's own side.
 */
const NOT_MONEY = ['receivable', 'payable', 'event_balance'];

interface Movable {
  occurredOn: string;
  description: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  moneyAccountId: string;
  moneyCurrency: string;
  chargedMinor: number;
  /** The purchase's own currency and amount: the original pair when the account charged another currency. */
  currency: string;
  amountMinor: number;
}

/** A posted purchase from one money account under one category, not already a shared event's; else why not. */
async function movableTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<Movable | string> {
  const [head] = await tx.values<[string, string, string, string | null, number | null]>(sql`
    SELECT occurred_on, description, status, original_currency, original_amount_minor FROM transactions WHERE id = ${transactionId} AND workspace_id = ${ws.workspaceId}`);
  if (!head || head[2] !== 'posted') return 'That transaction was deleted';
  if ((await tx.values(sql`SELECT 1 FROM event_postings WHERE transaction_id = ${transactionId}`)).length > 0) return 'Already in a shared event';
  const lines = await tx.values<[string, number, string, string, string, string, string | null]>(sql`
    SELECT e.account_id, e.amount_minor, e.currency, a.kind, a.subtype, a.name, a.icon FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId}`);
  const categories = lines.filter((l) => l[3] === 'expense');
  const money = lines.filter((l) => (l[3] === 'asset' || l[3] === 'liability') && !NOT_MONEY.includes(l[4]));
  // Exactly the two lines of a plain purchase: a split, a transfer, a purchase on someone's behalf or one through the
  // exchange account is more than one person's one expense, and moving it would lose what its other lines say.
  if (categories.length !== 1 || money.length !== 1 || lines.length !== 2) return NOT_MOVABLE;
  const [category] = categories;
  const [paid] = money;
  if (Number(category![1]) <= 0) return 'A refund stays where it is';
  // The original pair is the purchase's own figure only when it is another currency than the account was charged in.
  const original = head[3] !== null && head[4] !== null && head[3] !== paid![2];
  return {
    occurredOn: head[0],
    description: head[1],
    categoryId: category![0],
    categoryName: category![5],
    categoryIcon: category![6],
    moneyAccountId: paid![0],
    moneyCurrency: paid![2],
    chargedMinor: -Number(paid![1]),
    currency: original ? head[3]! : category![2],
    amountMinor: original ? Number(head[4]) : Number(category![1]),
  };
}

/** The event category by this name, made (captured) when the event has none yet. */
async function eventCategoryNamedTx(tx: Db, book: EventBookRow, name: string, icon: string | null): Promise<string> {
  const [found] = await tx.values<[string]>(
    sql`SELECT id FROM event_categories WHERE book_id = ${book.bookId} AND lower(name) = lower(${name}) AND archived_at IS NULL ORDER BY sort_order, id LIMIT 1`,
  );
  if (found) return found[0];
  const id = uuidv7();
  await withCapture(tx, { entity: 'event_category', id, bookId: book.bookId }, () =>
    tx.run(sql`
      INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at)
      VALUES (${book.bookId}, ${id}, ${name}, ${icon}, (SELECT coalesce(max(sort_order), 0) + 1 FROM event_categories WHERE book_id = ${book.bookId}), NULL)`),
  );
  return id;
}

/**
 * Units of the event currency per one `currency` on the day, through the base currency, as the Add screen would fill it;
 * null without a rate, or with one too small to keep as a rate string.
 */
async function rateToEventTx(tx: Db, book: EventBookRow, currency: string, on: string): Promise<string | null> {
  if (currency === book.currency) return '1';
  const from = await rateToBaseTx(tx, currency, book.baseCurrency, on);
  const to = await rateToBaseTx(tx, book.currency, book.baseCurrency, on);
  if (from === null || to === null) return null;
  try {
    return rateString(from / to);
  } catch (error) {
    if (error instanceof SharedEventError) return null;
    throw error;
  }
}

/** A move given up part-way: thrown to roll its own db transaction back, caught as a refusal. */
class KeptBack extends Error {
  constructor(readonly refusal: MoveRefusal) {
    super(refusal.why);
  }
}

/**
 * Moves each purchase into the shared event, each in its own db transaction, so one that cannot move never holds the
 * others back. Returns what moved (with the expense each became) and what stayed, with why. The event itself not being
 * open for writing (not shared here, no longer shared, Done) is thrown, as every other shared event write throws it.
 */
export async function moveIntoSharedEvent(
  database: Database,
  ws: WorkspaceContext,
  eventId: string,
  transactionIds: readonly string[],
): Promise<{ moved: { transactionId: string; expenseId: string }[]; kept: MoveRefusal[] }> {
  const moved: { transactionId: string; expenseId: string }[] = [];
  const kept: MoveRefusal[] = [];
  for (const transactionId of [...new Set(transactionIds)]) {
    try {
      const outcome = await database.transaction(async (tx): Promise<string | MoveRefusal> => {
        const book = await openSharedEventTx(tx, ws, eventId);
        const purchase = await movableTx(tx, ws, transactionId);
        if (typeof purchase === 'string') return { transactionId, why: purchase };
        const rateToEvent = await rateToEventTx(tx, book, purchase.currency, purchase.occurredOn);
        if (rateToEvent === null) return { transactionId, why: `No ${purchase.currency} or ${book.currency} rate for ${purchase.occurredOn} yet` };
        if ((await rateToBaseTx(tx, purchase.moneyCurrency, book.baseCurrency, purchase.occurredOn)) === null) {
          return { transactionId, why: `No ${purchase.moneyCurrency} rate for ${purchase.occurredOn} yet` };
        }
        const categoryId = await eventCategoryNamedTx(tx, book, purchase.categoryName, purchase.categoryIcon);
        // R12: a card goes on earning by the category the purchase was filed under (kept the first time it is given).
        await ensureShareAccountTx(tx, book, categoryId, purchase.categoryId);
        const expenseId = uuidv7();
        await withCapture(
          tx,
          [
            { entity: 'event_expense', id: expenseId, bookId: book.bookId },
            { entity: 'event_expense_detail', id: expenseId, bookId: book.bookId },
          ],
          async () => {
            await tx.run(sql`
              INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
              VALUES (${book.bookId}, ${expenseId}, ${purchase.occurredOn}, ${purchase.amountMinor}, ${purchase.currency}, ${rateToEvent}, ${book.me}, ${book.me}, NULL)`);
            await tx.run(sql`
              INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
              VALUES (${book.bookId}, ${expenseId}, ${purchase.description.trim() || null}, ${categoryId}, 'equal', ${splitJsonOf({ mode: 'equal', people: [book.me] })}, ${book.me}, NULL)`);
          },
        );
        // The purchase itself becomes the expense's derived transaction: replaced in place, never posted twice. The
        // account it was paid from, and what that account was charged when it is another currency (R5), stay here.
        await tx.run(sql`
          INSERT INTO event_postings (book_id, record_id, kind, transaction_id, account_id, account_amount_minor)
          VALUES (${book.bookId}, ${expenseId}, 'expense', ${transactionId}, ${purchase.moneyAccountId}, ${purchase.moneyCurrency === purchase.currency ? null : purchase.chargedMinor})`);
        await postEventRecordTx(tx, book.bookId, 'expense', expenseId, null);
        // Anything short of the purchase replaced by the expense's lines would leave it in its workspace and in the
        // event at once: the whole move is rolled back instead.
        const [after] = await tx.values<[string | null, string | null]>(sql`SELECT transaction_id, unposted FROM event_postings WHERE book_id = ${book.bookId} AND record_id = ${expenseId}`);
        if (!after || after[1] !== null || after[0] === null || after[0] === transactionId) {
          throw new KeptBack({ transactionId, why: after?.[1] === 'no-rate' ? `No rate for ${purchase.occurredOn} yet` : NOT_MOVABLE });
        }
        return expenseId;
      });
      if (typeof outcome === 'string') moved.push({ transactionId, expenseId: outcome });
      else kept.push(outcome);
    } catch (error) {
      if (error instanceof KeptBack) kept.push(error.refusal);
      // A purchase in a workspace that is no longer shared cannot leave it: that workspace is read-only.
      else if (error instanceof BookReadOnlyError) kept.push({ transactionId, why: error.message });
      else throw error;
    }
  }
  return { moved, kept };
}

/** What a posted purchase spent, in the base currency: its expense lines added up. */
async function spentBaseTx(tx: Db, transactionId: string): Promise<number> {
  const [row] = await tx.values<[number | null]>(sql`
    SELECT sum(e.amount_base_minor) FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind = 'expense'`);
  return Number(row?.[0] ?? 0);
}

/**
 * Sharing an existing event (§6), once, right after it is shared: its category set becomes the event's categories (a
 * card still earning by the set's), its plan becomes shared items in the event currency at today's rate, and its tagged
 * spending moves in, each item still answered by what bought it. What cannot move stays tagged, as it was.
 */
export async function convertEventToShared(database: Database, ws: WorkspaceContext, eventId: string): Promise<{ moved: number; kept: MoveRefusal[] }> {
  const local = await eventOf(database, ownerScope(ws), eventId);
  const book = await database.transaction((tx) => openSharedEventTx(tx, ws, eventId));
  // Read before anything moves: moving a purchase replaces it, and the plan's tick follows the replacement.
  const items = await listEventItems(database, ownerScope(ws), eventId);
  const today = new Date().toISOString().slice(0, 10);
  // A local plan is priced in the base currency; the shared one is in the event's, at today's rate. Checked before
  // anything is written, so an event with a plan and no rate yet is refused whole rather than half converted.
  const base = book.currency === book.baseCurrency ? 1 : await rateToBaseTx(database.db, book.currency, book.baseCurrency, today);
  if (items.length > 0 && base === null) throw new SharedEventDbError('NO_RATE', `No ${book.currency} rate for today yet`);
  const toEventCurrency = (minor: number) => convertMinor(minor, book.baseCurrency, book.currency, 1 / base!);

  // The set's categories, in the set's order, each tied to the workspace category a card earns by.
  const categoryFor = new Map<string, string>();
  if (local.setId) {
    for (const category of await listSetCategories(database, ownerScope(ws), local.setId)) {
      const id = await database.transaction(async (tx) => {
        const made = await eventCategoryNamedTx(tx, book, category.name, null);
        await ensureShareAccountTx(tx, book, made, category.id);
        return made;
      });
      categoryFor.set(category.id, id);
    }
  }

  const tagged = (await listTransactions(database, ownerScope(ws), { eventId, limit: 5_000 })).map((view) => view.id);
  const spent = new Map<string, number>();
  for (const id of tagged) spent.set(id, await spentBaseTx(database.db, id));
  const { moved, kept } = await moveIntoSharedEvent(database, ws, eventId, tagged);
  const expenseOf = new Map(moved.map((m) => [m.transactionId, m.expenseId]));

  for (const item of items) {
    const sharedId = await saveSharedItem(database, ws, eventId, {
      name: item.name,
      quantity: item.quantity,
      unitPriceMinor: Math.max(1, toEventCurrency(item.unitPriceMinor)),
      categoryId: item.categoryAccountId ? (categoryFor.get(item.categoryAccountId) ?? null) : null,
      link: item.link,
      note: item.note,
    });
    const expenseId = item.transactionId ? expenseOf.get(item.transactionId) : undefined;
    if (!expenseId || item.shareMinor === null || item.shareMinor <= 0) continue;
    // The item's part of the purchase, as that part of the expense in the event currency: converted the way the
    // expense itself was (its own rate on its own day), so it never comes out above what the expense paid.
    const record = await expenseRecordTx(database.db, book.bookId, expenseId);
    const total = spent.get(item.transactionId!) ?? 0;
    if (!record || total <= 0) continue;
    const { paidMinor } = expenseInEvent(record, book.currency);
    const share = Math.min(paidMinor, Number((BigInt(paidMinor) * BigInt(Math.min(item.shareMinor, total)) + BigInt(total) / 2n) / BigInt(total)));
    if (share > 0) await linkSharedItem(database, ws, eventId, sharedId, { expenseId, shareMinor: share });
  }
  return { moved: moved.length, kept };
}
