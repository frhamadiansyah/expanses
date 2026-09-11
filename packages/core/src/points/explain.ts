import { computeCycleEarn, type CycleBonus, type EarnOptions, type EarnRule, matchesSpend, type SpendLine } from './earn';

export interface CycleContext {
  lines: SpendLine[];
  rules: EarnRule[];
  ancestors: Record<string, string[]>;
  options: EarnOptions;
}

export type Suggestion =
  /** The purchase would earn `pointsWith` under this MCC, moving the estimate by `moves` points. */
  | { kind: 'mcc'; transactionId: string; mcc: string; pointsWith: number; moves: number }
  | { kind: 'bonus_threshold'; bonusId: string; eligibleSpendMinor: number; tierMinSpendMinor: number; bonus: number }
  | { kind: 'rounding'; points: number };

const tenths = (points: number) => Math.round(points * 10);
/** Only guessed MCCs are worth questioning; typed and remembered codes are the user's own facts. */
const guessed = (line: SpendLine) => line.mccSource !== 'typed' && line.mccSource !== 'memory';
const earnFor = (context: CycleContext, lines: SpendLine[] = context.lines) => computeCycleEarn(lines, context.rules, context.ancestors, context.options);
const withMcc = (lines: SpendLine[], transactionId: string, mcc: string): SpendLine[] =>
  lines.map((line) => (line.transactionId === transactionId ? { ...line, mcc, mccSource: 'typed' } : line));

/** Every code this card's rules and bonuses name, with ranges represented by their first code. */
export function candidateMccs(rules: readonly EarnRule[], bonuses: readonly CycleBonus[] = []): string[] {
  const specs = [...rules, ...bonuses].flatMap(({ match }) => [...(match.mccs ?? []), ...(match.excludeMccs ?? [])]);
  return [...new Set(specs.map((spec) => spec.split('-')[0] ?? spec))].sort();
}

/** MCCs under which one purchase would earn exactly what the bank credited, when its current MCC is a guess. */
export function explainTransaction(context: CycleContext, transactionId: string, actualPoints: number): Suggestion[] {
  const purchase = context.lines.filter((line) => line.transactionId === transactionId);
  if (purchase.length === 0 || !purchase.every(guessed)) return [];
  const estimate = earnFor(context).pointsByTransaction[transactionId] ?? 0;
  if (tenths(estimate) === tenths(actualPoints)) return [];
  const suggestions: Suggestion[] = [];
  for (const mcc of candidateMccs(context.rules, context.options.bonuses)) {
    if (purchase.every((line) => line.mcc === mcc)) continue;
    const pointsWith = earnFor(context, withMcc(context.lines, transactionId, mcc)).pointsByTransaction[transactionId] ?? 0;
    if (tenths(pointsWith) === tenths(actualPoints)) {
      suggestions.push({ kind: 'mcc', transactionId, mcc, pointsWith, moves: (tenths(pointsWith) - tenths(estimate)) / 10 });
    }
  }
  return suggestions;
}

/**
 * Likely reasons a statement total differs from the estimate: for each purchase with a guessed MCC, the candidate MCC
 * that brings the total closest to the statement (ranked by how much closer, then by amount); bonus tiers whose bonus
 * equals the gap while eligible spend sits within 1% of the threshold or within the cycle's refunds; and rounding when
 * the gap is smaller than the number of purchases.
 */
export function explainCycle(context: CycleContext, actualPoints: number, limit = 5): Suggestion[] {
  const base = earnFor(context);
  const gap = tenths(actualPoints) - tenths(base.totalPoints);
  if (gap === 0) return [];
  const candidates = candidateMccs(context.rules, context.options.bonuses);
  const purchases = [...new Set(context.lines.filter((line) => line.amountMinor > 0).map((line) => line.transactionId))];

  const ranked: { suggestion: Suggestion; closer: number; amount: number }[] = [];
  for (const transactionId of purchases) {
    const lines = context.lines.filter((line) => line.transactionId === transactionId);
    if (!lines.every(guessed)) continue;
    const amount = lines.reduce((sum, line) => sum + line.amountMinor, 0);
    let best: { suggestion: Suggestion; closer: number; amount: number } | null = null;
    for (const mcc of candidates) {
      if (lines.every((line) => line.mcc === mcc)) continue;
      const earn = earnFor(context, withMcc(context.lines, transactionId, mcc));
      const closer = Math.abs(gap) - Math.abs(tenths(actualPoints) - tenths(earn.totalPoints));
      if (closer > 0 && (!best || closer > best.closer)) {
        const suggestion: Suggestion = { kind: 'mcc', transactionId, mcc, pointsWith: earn.pointsByTransaction[transactionId] ?? 0, moves: (tenths(earn.totalPoints) - tenths(base.totalPoints)) / 10 };
        best = { suggestion, closer, amount };
      }
    }
    if (best) ranked.push(best);
  }
  ranked.sort((a, b) => b.closer - a.closer || b.amount - a.amount);
  const suggestions = ranked.map((entry) => entry.suggestion);

  const billingCurrency = context.options.billingCurrency ?? 'IDR';
  for (const bonus of context.options.bonuses ?? []) {
    const eligible = base.eligibleSpendByBonus[bonus.id] ?? 0;
    const refunded = context.lines
      .filter((line) => line.amountMinor < 0 && matchesSpend(bonus.match, line, context.ancestors, billingCurrency))
      .reduce((sum, line) => sum - line.amountMinor, 0);
    for (const tier of bonus.tiers) {
      if (Math.abs(gap) !== tier.bonus * 10) continue;
      if (Math.abs(eligible - tier.minSpendMinor) <= Math.max(Math.ceil(tier.minSpendMinor / 100), refunded)) {
        suggestions.push({ kind: 'bonus_threshold', bonusId: bonus.id, eligibleSpendMinor: eligible, tierMinSpendMinor: tier.minSpendMinor, bonus: tier.bonus });
      }
    }
  }
  if (Math.abs(gap) < purchases.length * 10) suggestions.push({ kind: 'rounding', points: gap / 10 });
  return suggestions.slice(0, limit);
}
