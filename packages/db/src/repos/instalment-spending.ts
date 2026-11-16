import { type InstalmentCountMode, instalmentsFrom, instalmentSpendingLines, instalmentsCountedIn, type PartWeight } from '@expanses/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { cardTerms } from '../schema-points';
import { hasBooks, personalBookIdTx } from './books';
import { type CardInstallmentRow, listInstallmentsTx } from './installments';
import { uncategorisedIdOf } from './uncategorised';

/*
 * Card instalments, option C (owner, 16 Nov 2026). A plan that counts Each month spreads its purchase: each instalment
 * is that month's spending on its statement date, in the purchase's categories, and the purchase itself counts nothing.
 * Nothing is stored for it — the instalments are worked out from the plan, as the card's statements already work them
 * out (`billedLines`), so the card's balance never holds the purchase twice and two phones never race to write rows.
 *
 * Every reading of spending stands on this file and on the same filters as the purchase: Cashflow's rings, bars and
 * list, the budget, Essential · Lifestyle · Debts & savings and Financial health. A plan that counts At purchase is read
 * as before: the purchase counts whole on its day, and each instalment is a repayment of the card.
 */

export interface PlanWithDay {
  plan: CardInstallmentRow;
  /** The card's statement day; the 1st when none was set, as the statements read it. */
  statementDay: number;
  /**
   * A spread that came from the payer's phone in a shared workspace (`purchase_spreads`, 0121): what all of the
   * purchase's category lines came to there, which this phone — holding only the shared part — cannot work out itself.
   * Absent for this phone's own plans, whose purchase is all here.
   */
  wholeBaseMinor?: number;
  /** True for such a spread: there is no plan here to open, nor any debt of this phone's. */
  received?: boolean;
  /**
   * The day the card's records start in the app (`cardRecordsFrom`): an instalment billed before it is inside the
   * card's opening balance, in months the app was not kept, and counts nowhere. Null for none known (and for a spread
   * from another phone, whose purchase is recorded, so it has none of its instalments before the records anyway).
   */
  recordsFrom?: string | null;
}

/**
 * The day a card's records start in the app: its opening balance's date, else the day it is counted from (0107), else
 * its first transaction. Null for a card with nothing on it yet.
 */
export async function cardRecordsFrom(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<string | null> {
  const [opening] = await db.values<[string | null]>(sql`
    SELECT MIN(t.occurred_on) FROM transactions t
    JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${cardAccountId}
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND EXISTS (SELECT 1 FROM entries o JOIN accounts oa ON oa.id = o.account_id
                  WHERE o.transaction_id = t.id AND oa.kind = 'equity' AND oa.system_key = 'opening_balance')`);
  if (opening?.[0]) return opening[0];
  if ((await db.values(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'counted_from'`)).length > 0) {
    const [row] = await db.values<[string | null]>(sql`SELECT counted_from FROM accounts WHERE id = ${cardAccountId} AND workspace_id = ${ws.workspaceId}`);
    if (row?.[0]) return row[0];
  }
  const [first] = await db.values<[string | null]>(sql`
    SELECT MIN(t.occurred_on) FROM transactions t JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${cardAccountId}
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'`);
  return first?.[0] ?? null;
}

/**
 * What a purchase's `spread` field carries (card instalments C, sync): everything another phone needs to work the
 * purchase's Each month instalment lines out with the same function, to the same rupiah.
 */
export interface PurchaseSpread {
  months: number;
  firstBilledMonth: string;
  totalMinor: number;
  monthlyMinor: number;
  statementDay: number;
  wholeBaseMinor: number;
}

const spreadsTable = new WeakMap<Db, boolean>();

/** Whether 0121 is here: a database before it holds no spread from another phone. */
export async function purchaseSpreadsExist(db: Db): Promise<boolean> {
  if (spreadsTable.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'purchase_spreads'`);
  if (rows.length > 0) spreadsTable.set(db, true);
  return rows.length > 0;
}

/** A `spread` as it arrived, or null for anything that is not one (an unknown shape is no spread). */
export function readPurchaseSpread(value: unknown): PurchaseSpread | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
  if (!whole(v.months) || (v.months as number) < 1 || !whole(v.totalMinor) || !whole(v.monthlyMinor) || !whole(v.statementDay) || !whole(v.wholeBaseMinor)) return null;
  if (typeof v.firstBilledMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.firstBilledMonth)) return null;
  const statementDay = v.statementDay as number;
  if (statementDay < 1 || statementDay > 31) return null;
  return {
    months: v.months as number,
    firstBilledMonth: v.firstBilledMonth,
    totalMinor: v.totalMinor as number,
    monthlyMinor: v.monthlyMinor as number,
    statementDay,
    wholeBaseMinor: v.wholeBaseMinor as number,
  };
}

/**
 * The spread a purchase travels with, read on the payer's phone from its own plan: a plan counting Each month tied to
 * this transaction, its card's statement day, and what all its category lines come to. Null when there is none, or when
 * the shared workspace keeps its books in another currency than the card's (owner ruling, 16 Nov 2026): both phones
 * then count it at purchase. On the other phone, the spread it was sent.
 */
export async function purchaseSpreadOfTx(db: Db, transactionId: string, bookId: string | null): Promise<PurchaseSpread | null> {
  const plans = await db.values<[string, number, number, number, string, string | null]>(sql`
    SELECT i.card_account_id, i.months, i.total_minor, i.monthly_minor, i.first_billed_month, a.currency
    FROM card_installments i JOIN accounts a ON a.id = i.card_account_id
    WHERE i.transaction_id = ${transactionId} AND i.count_mode = 'each_month' LIMIT 1`).catch(() => [] as [string, number, number, number, string, string | null][]);
  const plan = plans[0];
  if (plan) {
    const [cardAccountId, months, totalMinor, monthlyMinor, firstBilledMonth, cardCurrency] = plan;
    if (bookId) {
      const [book] = await db.values<[string]>(sql`SELECT base_currency FROM books WHERE id = ${bookId}`);
      if (book && cardCurrency && book[0] !== cardCurrency) return null;
    }
    const [terms] = await db.values<[number | null]>(sql`SELECT statement_day FROM card_terms WHERE account_id = ${cardAccountId}`);
    const [whole] = await db.values<[number | null]>(sql`
      SELECT SUM(e.amount_base_minor) FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${transactionId} AND a.kind = 'expense'`);
    return {
      months: Number(months),
      firstBilledMonth,
      totalMinor: Number(totalMinor),
      monthlyMinor: Number(monthlyMinor),
      statementDay: Number(terms?.[0] ?? 1),
      wholeBaseMinor: Number(whole?.[0] ?? 0),
    };
  }
  if (!(await purchaseSpreadsExist(db))) return null;
  const [row] = await db.values<[number, string, number, number, number, number]>(sql`
    SELECT months, first_billed_month, total_minor, monthly_minor, statement_day, whole_base_minor FROM purchase_spreads WHERE transaction_id = ${transactionId}`);
  if (!row) return null;
  return { months: Number(row[0]), firstBilledMonth: row[1], totalMinor: Number(row[2]), monthlyMinor: Number(row[3]), statementDay: Number(row[4]), wholeBaseMinor: Number(row[5]) };
}

/**
 * The spreads that came from the payer's phone (0121), as plans counting Each month: on the purchase's money account
 * (the payer's placeholder here), never a debt of this phone's. A purchase this phone has a plan of its own for is its
 * own plan's.
 */
async function receivedPlansTx(db: Db, ws: WorkspaceContext, own: ReadonlySet<string>): Promise<PlanWithDay[]> {
  if (!(await purchaseSpreadsExist(db))) return [];
  const rows = await db.values<[string, number, string, number, number, number, number, string, string]>(sql`
    SELECT s.transaction_id, s.months, s.first_billed_month, s.total_minor, s.monthly_minor, s.statement_day, s.whole_base_minor, t.description,
      (SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id
        WHERE e.transaction_id = s.transaction_id AND a.kind NOT IN ('income', 'expense') ORDER BY e.amount_minor ASC, e.rowid LIMIT 1)
    FROM purchase_spreads s JOIN transactions t ON t.id = s.transaction_id
    WHERE s.workspace_id = ${ws.workspaceId} AND t.status = 'posted'`);
  return rows
    .filter(([transactionId]) => !own.has(transactionId))
    .map(([transactionId, months, firstBilledMonth, totalMinor, monthlyMinor, statementDay, wholeBaseMinor, description, moneyAccountId]) => ({
      plan: {
        id: `spread:${transactionId}`,
        cardAccountId: moneyAccountId ?? '',
        transactionId,
        description,
        createdAt: '',
        totalMinor: Number(totalMinor),
        months: Number(months),
        monthlyMinor: Number(monthlyMinor),
        firstBilledMonth,
        rateBps: 0,
        conversionFeeMinor: 0,
        earnsPoints: true,
        countMode: 'each_month' as const,
        categoryAccountId: null,
        linkedToTrade: false,
      },
      statementDay: Number(statementDay),
      wholeBaseMinor: Number(wholeBaseMinor),
      received: true,
    }));
}

/**
 * Every plan in the workspace, with its card's statement day — and every spread another phone sent for a purchase here
 * (`receivedPlansTx`), which counts the same way.
 */
export async function plansWithStatementDays(db: Db, ws: WorkspaceContext): Promise<PlanWithDay[]> {
  const plans = await listInstallmentsTx(db, ws);
  const cardIds = [...new Set(plans.map((plan) => plan.cardAccountId))];
  const terms = cardIds.length
    ? await db
        .select({ accountId: cardTerms.accountId, statementDay: cardTerms.statementDay })
        .from(cardTerms)
        .where(and(eq(cardTerms.workspaceId, ws.workspaceId), inArray(cardTerms.accountId, cardIds)))
    : [];
  const dayOf = new Map(terms.map((term) => [term.accountId, term.statementDay ?? 1]));
  const recordsOf = new Map<string, string | null>();
  for (const cardId of cardIds) recordsOf.set(cardId, await cardRecordsFrom(db, ws, cardId));
  const own = plans.map((plan) => ({ plan, statementDay: dayOf.get(plan.cardAccountId) ?? 1, recordsFrom: recordsOf.get(plan.cardAccountId) ?? null }));
  const received = await receivedPlansTx(db, ws, new Set(plans.flatMap((plan) => (plan.transactionId ? [plan.transactionId] : []))));
  return [...own, ...received, ...(await receivedPlanSpreadsTx(db, ws, new Set(plans.map((plan) => plan.id))))];
}

/**
 * The plans with no purchase another phone sent (plan_spreads, 0123), as plans counting Each month in their own
 * category, from the day the payer's card's records start. A row of this phone's own plan is its plan's.
 */
async function receivedPlanSpreadsTx(db: Db, ws: WorkspaceContext, own: ReadonlySet<string>): Promise<PlanWithDay[]> {
  if ((await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_spreads'`)).length === 0) return [];
  const rows = await db.values<[string, string, number, number, number, string, number, string | null, string]>(sql`
    SELECT id, description, total_minor, monthly_minor, months, first_billed_month, statement_day, records_from, category_account_id
    FROM plan_spreads WHERE workspace_id = ${ws.workspaceId}`);
  return rows
    .filter(([id]) => !own.has(id))
    .map(([id, description, totalMinor, monthlyMinor, months, firstBilledMonth, statementDay, recordsFrom, categoryAccountId]) => ({
      plan: {
        id: `plan-spread:${id}`,
        cardAccountId: '',
        transactionId: null,
        description,
        createdAt: '',
        totalMinor: Number(totalMinor),
        months: Number(months),
        monthlyMinor: Number(monthlyMinor),
        firstBilledMonth,
        rateBps: 0,
        conversionFeeMinor: 0,
        earnsPoints: true,
        countMode: 'each_month' as const,
        categoryAccountId,
        linkedToTrade: false,
      },
      statementDay: Number(statementDay),
      recordsFrom,
      received: true,
    }));
}

export const countsEachMonth = (plan: { countMode: InstalmentCountMode }) => plan.countMode === 'each_month';

/**
 * The purchases whose plan counts each month: what every spending reading leaves out on the purchase's own day. A plan
 * whose purchase was deleted has nothing to leave out, so the set is only of the ids plans name.
 */
export function spreadPurchaseIds(plans: readonly PlanWithDay[]): string[] {
  return [...new Set(plans.filter(({ plan }) => countsEachMonth(plan) && plan.transactionId).map(({ plan }) => plan.transactionId!))];
}

/** One instalment counted as spending in one category, in the owner's currency. */
export interface SpreadLine {
  /** The plan's id; `spread:` and the purchase's id for a spread another phone sent, which has no plan here. */
  planId: string;
  cardAccountId: string;
  /** The purchase it spreads; null for a plan with no purchase, counted under Uncategorised. */
  transactionId: string | null;
  description: string;
  number: number;
  of: number;
  statementOn: string;
  categoryId: string;
  amountBaseMinor: number;
  /** A spread the payer's phone sent (0121): there is no plan on this phone to open. */
  received?: boolean;
}

/**
 * Where a plan with no purchase counts each month: Uncategorised of the owner's Personal workspace (the card is the
 * owner's, and no other workspace was named). Read in another workspace it counts nowhere. Null when that row has not
 * been made yet, or the workspace being read is not Personal.
 */
async function uncategorisedForPlans(db: Db, ws: WorkspaceContext): Promise<string | null> {
  const books = await hasBooks(db);
  const personal = books ? await personalBookIdTx(db, ws.workspaceId) : null;
  if (ws.bookId && personal && ws.bookId !== personal) return null;
  const id = await uncategorisedIdOf(personal ?? ws.workspaceId, 'expense');
  const [found] = await db.values<[string]>(sql`SELECT id FROM accounts WHERE id = ${id} AND kind = 'expense'`);
  return found ? id : null;
}

/**
 * The instalments of Each month plans whose statement date falls in [from, to], as spending lines. `purchaseParts`
 * says how each spread purchase counts in the reading asked for — its category lines that pass the reading's filters,
 * already shared by the Paid with filter when there is one — and `purchaseWhole` what all its category lines come to.
 * A purchase the filters leave out entirely (excluded, an event held out, another workspace's) has no parts, so its
 * instalments are left out with it.
 */
export async function spreadLinesIn(
  db: Db,
  ws: WorkspaceContext,
  plans: readonly PlanWithDay[],
  from: string,
  to: string,
  purchaseParts: ReadonlyMap<string, readonly PartWeight[]>,
  purchaseWhole: ReadonlyMap<string, number>,
  opts: { paidAccountId?: string } = {},
): Promise<SpreadLine[]> {
  const spreading = plans.filter(({ plan }) => countsEachMonth(plan));
  if (spreading.length === 0) return [];
  const needsUncategorised = spreading.some(({ plan }) => !plan.transactionId && !plan.categoryAccountId);
  const unfiled = needsUncategorised ? await uncategorisedForPlans(db, ws) : null;
  const out: SpreadLine[] = [];
  for (const { plan, statementDay, wholeBaseMinor, received, recordsFrom } of spreading) {
    let parts: readonly PartWeight[];
    let whole: number | undefined;
    if (plan.transactionId) {
      parts = purchaseParts.get(plan.transactionId) ?? [];
      // A spread from the payer's phone carries the whole it was worked out against: this phone may hold only a part.
      whole = wholeBaseMinor ?? purchaseWhole.get(plan.transactionId);
    } else {
      // No purchase: the card paid all of it, so a Paid with filter on another account leaves it out. It counts in the
      // plan's own category (0122), else Uncategorised — in the workspace that category is in, and nowhere else.
      if (opts.paidAccountId && opts.paidAccountId !== plan.cardAccountId) continue;
      const category = plan.categoryAccountId ?? unfiled;
      if (!category || (plan.categoryAccountId && !(await categoryIsReadTx(db, ws, plan.categoryAccountId)))) continue;
      parts = [{ key: category, weight: 1 }];
      whole = 1;
    }
    if (parts.length === 0) continue;
    // Billed before the card's records start: inside its opening balance, in months the app was not kept — nowhere.
    const lines = instalmentsFrom(instalmentSpendingLines(plan, statementDay, parts, whole), recordsFrom ?? null);
    for (const line of instalmentsCountedIn(lines, from, to)) {
      out.push({
        planId: plan.id,
        cardAccountId: plan.cardAccountId,
        transactionId: plan.transactionId,
        description: plan.description,
        number: line.number,
        of: line.of,
        statementOn: line.statementOn,
        categoryId: line.categoryKey,
        amountBaseMinor: line.amountMinor,
        ...(received ? { received: true } : {}),
      });
    }
  }
  return out;
}

/** Whether a category counts in the reading: the open workspace's own, or any when none is open. */
async function categoryIsReadTx(db: Db, ws: WorkspaceContext, categoryAccountId: string): Promise<boolean> {
  if (!ws.bookId || !(await hasBooks(db))) return true;
  const rows = await db.values(sql`SELECT 1 FROM book_categories WHERE book_id = ${ws.bookId} AND category_account_id = ${categoryAccountId}`);
  return rows.length > 0;
}

/** What every category line of each purchase comes to, in the owner's currency: the whole a part is a share of. */
export async function purchaseWholes(db: Db, transactionIds: readonly string[]): Promise<Map<string, number>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await db.values<[string, number]>(sql`
    SELECT e.transaction_id, SUM(e.amount_base_minor) FROM entries e JOIN accounts a ON a.id = e.account_id
    WHERE a.kind = 'expense' AND e.transaction_id IN ${[...transactionIds]}
    GROUP BY e.transaction_id`);
  return new Map(rows.map(([id, total]) => [id, Number(total)]));
}
