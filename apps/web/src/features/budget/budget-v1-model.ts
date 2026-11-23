import type { CategoryNeed } from '@expanses/core';
import type { DeskRow } from './budget-desk-model';
import type { EditRow } from './edit-budgets-model';

/*
 * The Mac Budget page, option B (owner, 2026-11-23): three tiles, then one card for each of Essential, Lifestyle and
 * Debts & savings with a row per budgeted category (spent of its budget, what is left or over); the budgets themselves
 * are typed in the Edit plan panel, grouped the same three ways. A category counts as what its own mark says; a
 * category with none counts as Essential, as everywhere else.
 */

export const NEED_ORDER: readonly CategoryNeed[] = ['essential', 'lifestyle', 'debts_savings'];
export const NEED_TITLES: Record<CategoryNeed, string> = { essential: 'Essential', lifestyle: 'Lifestyle', debts_savings: 'Debts & savings' };

const needOf = (id: string, needs: Readonly<Record<string, CategoryNeed>>) => needs[id] ?? 'essential';

export interface NeedCard {
  need: CategoryNeed;
  title: string;
  rows: DeskRow[];
}

/**
 * The cards: every category with a budget of its own this month (the table's budgeted lines — a parent's own budget is
 * its "All …" line), in the table's order, under what it counts as. A card with nothing budgeted is left out.
 */
export function needCards(rows: readonly DeskRow[], needs: Readonly<Record<string, CategoryNeed>>): NeedCard[] {
  const lines = rows.filter((row) => row.kind === 'line' && row.section === 'budgeted' && row.budgetMinor !== null && row.budgetMinor > 0);
  return NEED_ORDER.map((need) => ({ need, title: NEED_TITLES[need], rows: lines.filter((row) => needOf(row.categoryId, needs) === need) })).filter((card) => card.rows.length > 0);
}

/** "Rp 880.000 left" or "Rp 110.000 over", from what is left (below nought when over). */
export function leftWords(leftMinor: number, money: (minor: number) => string): { text: string; over: boolean } {
  return leftMinor < 0 ? { text: `${money(-leftMinor)} over`, over: true } : { text: `${money(leftMinor)} left`, over: false };
}

export interface PlanGroup {
  need: CategoryNeed;
  title: string;
  rows: EditRow[];
}

/** Edit plan's rows, in Edit budgets' own order, under what each counts as; a part with no category is left out. */
export function planGroups(rows: readonly EditRow[], needs: Readonly<Record<string, CategoryNeed>>): PlanGroup[] {
  return NEED_ORDER.map((need) => ({ need, title: NEED_TITLES[need], rows: rows.filter((row) => needOf(row.id, needs) === need) })).filter((group) => group.rows.length > 0);
}
