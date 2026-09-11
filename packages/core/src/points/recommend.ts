import { computeCycleEarn, type EarnRule, ruleMatches, type SpendLine } from './earn';

export interface Redemption {
  valueMinor: number;
  perPoints: number;
  currency: string;
}

export interface CardCandidate {
  cardAccountId: string;
  cardName: string;
  currency: string;
  rules: EarnRule[];
  /** Posted spend already in the card's current cycle. */
  cycleLines: SpendLine[];
  bestRedemption: Redemption | null;
}

export interface PurchaseQuery {
  amountMinor: number;
  currency: string;
  categoryId: string;
  description: string;
  occurredOn: string;
}

export interface Recommendation {
  cardAccountId: string;
  cardName: string;
  eligible: boolean;
  points: number;
  valueMinor: number | null;
  valueCurrency: string | null;
  /** Value as basis points of the purchase amount, when value and purchase share a currency. */
  effectiveRateBps: number | null;
  capHeadroom: { ruleId: string; ruleName: string; remainingMinor: number }[];
}

/** Marginal points and value of adding the purchase to each card's current cycle, best first. */
export function recommendCards(query: PurchaseQuery, candidates: CardCandidate[], ancestors: Record<string, string[]>): Recommendation[] {
  const hypothetical: SpendLine = { ...query, transactionId: '￿', entryId: '￿' };
  const results = candidates.map((card): Recommendation => {
    if (card.currency !== query.currency || query.amountMinor <= 0) {
      return { cardAccountId: card.cardAccountId, cardName: card.cardName, eligible: false, points: 0, valueMinor: null, valueCurrency: null, effectiveRateBps: null, capHeadroom: [] };
    }
    const before = computeCycleEarn(card.cycleLines, card.rules, ancestors);
    const after = computeCycleEarn([...card.cycleLines, hypothetical], card.rules, ancestors);
    const points = after.totalPoints - before.totalPoints;
    const r = card.bestRedemption;
    const valueMinor = r ? Math.floor((points * r.valueMinor) / r.perPoints) : null;
    const effectiveRateBps = r && valueMinor !== null && r.currency === query.currency ? Math.round((valueMinor * 10_000) / query.amountMinor) : null;
    const capHeadroom = card.rules
      .filter((rule) => rule.capSpendMinor !== null && ruleMatches(rule, hypothetical, ancestors))
      .map((rule) => ({ ruleId: rule.id, ruleName: rule.name, remainingMinor: Math.max(0, rule.capSpendMinor! - (before.spendByRule[rule.id] ?? 0)) }));
    return { cardAccountId: card.cardAccountId, cardName: card.cardName, eligible: true, points, valueMinor, valueCurrency: r?.currency ?? null, effectiveRateBps, capHeadroom };
  });
  return results.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      (b.valueMinor ?? -1) - (a.valueMinor ?? -1) ||
      b.points - a.points ||
      a.cardName.localeCompare(b.cardName),
  );
}

/** Highest value per point among redemption options. */
export function bestRedemption(options: Redemption[]): Redemption | null {
  let best: Redemption | null = null;
  for (const option of options) {
    if (option.perPoints <= 0) continue;
    if (!best || option.valueMinor * best.perPoints > best.valueMinor * option.perPoints) best = option;
  }
  return best;
}
