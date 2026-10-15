import { type BudgetLine, bpOf, formatBp, parseMajor, parsePercentBp, type ShareBasis, shareOfMinor } from '@expanses/core';
import { bareFigure } from '../networth/debt-rows';

/** What a % typed for a category is of: its parent's budget, or this month's take-home. */
export interface ShareBase {
  basis: ShareBasis;
  label: string;
  minor: number;
}

/** The parent's budget when the category's direct parent has one; take-home otherwise. */
export function shareBaseOf(lines: readonly BudgetLine[], categoryId: string, takeHomeMinor: number): ShareBase {
  const parentOf = (rows: readonly BudgetLine[], parent: BudgetLine | null): BudgetLine | null | undefined => {
    for (const row of rows) {
      if (row.id === categoryId) return parent;
      const found = parentOf(row.children, row);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const parent = parentOf(lines, null);
  if (parent && parent.capMinor !== null) return { basis: 'parent', label: parent.name, minor: parent.capMinor };
  return { basis: 'take-home', label: 'take-home', minor: takeHomeMinor };
}

/** A typed amount as its share of the basis; empty when it cannot be read or there is no basis. */
export function toPercent(amount: string, base: ShareBase, currency: string): string {
  if (!amount.trim()) return '';
  try {
    const bp = bpOf(parseMajor(amount, currency), base.minor);
    return bp === null ? '' : formatBp(bp);
  } catch {
    return '';
  }
}

/** A typed share as the amount it comes to; empty when it cannot be read. */
export function toAmount(percent: string, base: ShareBase, currency: string): string {
  try {
    return bareFigure(shareOfMinor(base.minor, parsePercentBp(percent), currency), currency);
  } catch {
    return '';
  }
}
