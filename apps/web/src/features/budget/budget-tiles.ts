import type { NeedsPlanRow } from '@expanses/core';
import { tileMoney } from '../../ui/desk';

/*
 * The three tiles on the Mac Budget (v1, owner approved 2026-11-23): Essential, Lifestyle and Debts & savings, each the
 * figure the phone's Essential · Lifestyle · Debts & savings box shows (`needsPlan`) — what it used this month, of what
 * the month planned for it — with one tag saying how that stands. One plain rule a side:
 * - Essential and Lifestyle are spending: the tag is what is left of the plan, or red "… over" once past it.
 * - Debts & savings is what the income kept: the tag is what is still to go to reach its plan, "On plan" once reached,
 *   and red when the month spent more than came in (the figure below nought).
 * No plan for a side (no cap set under it): no tag, and the label is its name alone.
 */

export type TileTone = 'side' | 'over';

export interface BudgetTile {
  key: NeedsPlanRow['key'];
  usedMinor: number;
  plannedMinor: number | null;
  /** "Rp 2,79 jt left", "Rp 110.000 over", "Rp 4,15 jt to go", "On plan"; null with no plan. */
  tag: { text: string; tone: TileTone } | null;
}

export function budgetTiles(rows: readonly NeedsPlanRow[], currency: string): BudgetTile[] {
  return rows.map((row) => {
    const base = { key: row.key, usedMinor: row.usedMinor, plannedMinor: row.plannedMinor };
    if (row.plannedMinor === null) return { ...base, tag: null };
    const leftMinor = row.plannedMinor - row.usedMinor;
    if (row.key === 'debtsSavings') {
      const tone: TileTone = row.usedMinor < 0 ? 'over' : 'side';
      return { ...base, tag: { text: leftMinor > 0 ? `${tileMoney(leftMinor, currency)} to go` : 'On plan', tone } };
    }
    return {
      ...base,
      tag: leftMinor >= 0 ? { text: `${tileMoney(leftMinor, currency)} left`, tone: 'side' } : { text: `${tileMoney(-leftMinor, currency)} over`, tone: 'over' },
    };
  });
}
