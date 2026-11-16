import { type InstalmentCountMode, instalmentSpendingLines, instalmentsCountedIn, type PartWeight } from '@expanses/core';
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
}

/** Every plan in the workspace, with its card's statement day. */
export async function plansWithStatementDays(db: Db, ws: WorkspaceContext): Promise<PlanWithDay[]> {
  const plans = await listInstallmentsTx(db, ws);
  if (plans.length === 0) return [];
  const cardIds = [...new Set(plans.map((plan) => plan.cardAccountId))];
  const terms = await db
    .select({ accountId: cardTerms.accountId, statementDay: cardTerms.statementDay })
    .from(cardTerms)
    .where(and(eq(cardTerms.workspaceId, ws.workspaceId), inArray(cardTerms.accountId, cardIds)));
  const dayOf = new Map(terms.map((term) => [term.accountId, term.statementDay ?? 1]));
  return plans.map((plan) => ({ plan, statementDay: dayOf.get(plan.cardAccountId) ?? 1 }));
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
  const needsUncategorised = spreading.some(({ plan }) => !plan.transactionId);
  const unfiled = needsUncategorised ? await uncategorisedForPlans(db, ws) : null;
  const out: SpreadLine[] = [];
  for (const { plan, statementDay } of spreading) {
    let parts: readonly PartWeight[];
    let whole: number | undefined;
    if (plan.transactionId) {
      parts = purchaseParts.get(plan.transactionId) ?? [];
      whole = purchaseWhole.get(plan.transactionId);
    } else {
      // No purchase: the card paid all of it, so a Paid with filter on another account leaves it out.
      if (!unfiled || (opts.paidAccountId && opts.paidAccountId !== plan.cardAccountId)) continue;
      parts = [{ key: unfiled, weight: 1 }];
      whole = 1;
    }
    if (parts.length === 0) continue;
    for (const line of instalmentsCountedIn(instalmentSpendingLines(plan, statementDay, parts, whole), from, to)) {
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
      });
    }
  }
  return out;
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
