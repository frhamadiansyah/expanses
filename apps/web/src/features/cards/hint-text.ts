import { formatMinor, mccName, type MccSource, type SpendLine, type Suggestion } from '@expanses/core';
import type { TransactionPointActual } from '@expanses/db';
import { type CycleResult, formatPoints } from './useCardPoints';

export interface PurchaseRow {
  transactionId: string;
  occurredOn: string;
  description: string;
  amountMinor: number;
  mcc: string | null;
  mccSource: MccSource | null;
  cardFee: boolean;
}

/** One row per purchase, in cycle order; split lines add up and the first line's MCC represents the purchase. */
export function purchasesOf(lines: readonly SpendLine[]): PurchaseRow[] {
  const rows = new Map<string, PurchaseRow>();
  for (const line of lines) {
    const row = rows.get(line.transactionId);
    if (row) row.amountMinor += line.amountMinor;
    else rows.set(line.transactionId, { transactionId: line.transactionId, occurredOn: line.occurredOn, description: line.description, amountMinor: line.amountMinor, mcc: line.mcc, mccSource: line.mccSource, cardFee: line.cardFee ?? false });
  }
  return [...rows.values()];
}

/**
 * Running total for a card that credits per purchase: actuals for checked purchases, estimates for the rest, plus the
 * bonus points credited when recorded or the estimated bonuses otherwise.
 */
export function checkedTotals(result: CycleResult, actuals: readonly TransactionPointActual[]): { checked: number; purchases: number; total: number } {
  const recorded = new Map(actuals.map((actual) => [actual.transactionId, actual.actualPoints]));
  const purchases = purchasesOf(result.lines);
  let checked = 0;
  let tenths = 0;
  for (const purchase of purchases) {
    const actual = recorded.get(purchase.transactionId);
    if (actual !== undefined) checked += 1;
    tenths += Math.round((actual ?? result.earn.pointsByTransaction[purchase.transactionId] ?? 0) * 10);
  }
  const bonus = result.actual ?? Object.values(result.earn.bonusById).reduce((sum, points) => sum + points, 0);
  return { checked, purchases: purchases.length, total: (tenths + Math.round(bonus * 10)) / 10 };
}

export function describeSuggestion(suggestion: Suggestion, unit: string, currency: string, descriptions: Readonly<Record<string, string>> = {}): string {
  switch (suggestion.kind) {
    case 'mcc': {
      const name = mccName(suggestion.mcc);
      const moves = `${suggestion.moves > 0 ? '+' : ''}${formatPoints(suggestion.moves)}`;
      return `${descriptions[suggestion.transactionId] ?? 'This purchase'} as MCC ${suggestion.mcc}${name ? ` ${name}` : ''} would earn ${formatPoints(suggestion.pointsWith)} ${unit} (${moves} on the cycle).`;
    }
    case 'bonus_threshold':
      return `${formatMinor(suggestion.eligibleSpendMinor, currency)} counted toward the bonus, right at the ${formatMinor(suggestion.tierMinSpendMinor, currency)} threshold for ${formatPoints(suggestion.bonus)} ${unit}. The bank may count a purchase or refund differently.`;
    case 'rounding':
      return `A difference of ${formatPoints(Math.abs(suggestion.points))} ${unit} can come from how the bank rounds each purchase.`;
  }
}
