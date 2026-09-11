import { computeCycleEarn, type CycleBonus, type EarnRule, ruleMatches, type SpendLine } from './earn';
import { estimatePartnerUnits, partnerFor, type TransferPartner } from './transfer';

export interface Redemption {
  valueMinor: number;
  perPoints: number;
  currency: string;
}

/** Compare cards by redemption value, or by units of a loyalty program reached directly or through a transfer partner. */
export type CompareTarget = { kind: 'value' } | { kind: 'program'; program: string };

export interface CardCandidate {
  cardAccountId: string;
  cardName: string;
  currency: string;
  /** Program the card earns directly, e.g. KrisFlyer or UnionPay Points. */
  programName: string | null;
  rules: EarnRule[];
  bonuses: CycleBonus[];
  transferPartners: TransferPartner[];
  /** Posted spend already in the card's current cycle. */
  cycleLines: SpendLine[];
  bestRedemption: Redemption | null;
}

export interface PurchaseQuery {
  amountMinor: number;
  currency: string;
  originalCurrency: string | null;
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
  /** Whether the card can be ranked in the requested comparison. */
  comparable: boolean;
  /** Redemption value or program units used for ranking. */
  compareUnits: number | null;
  capHeadroom: { ruleId: string; ruleName: string; remainingMinor: number }[];
}

/** Marginal points of adding the purchase to each card's current cycle, including bonus tiers it crosses, best first. */
export function recommendCards(
  query: PurchaseQuery,
  candidates: CardCandidate[],
  ancestors: Record<string, string[]>,
  target: CompareTarget = { kind: 'value' },
): Recommendation[] {
  // Sorts after any real purchase on the same date.
  const hypothetical: SpendLine = { ...query, transactionId: '￿', entryId: '￿' };
  const results = candidates.map((card): Recommendation => {
    if (card.currency !== query.currency || query.amountMinor <= 0) {
      return { cardAccountId: card.cardAccountId, cardName: card.cardName, eligible: false, points: 0, valueMinor: null, valueCurrency: null, effectiveRateBps: null, comparable: false, compareUnits: null, capHeadroom: [] };
    }
    const options = { bonuses: card.bonuses ?? [], billingCurrency: card.currency };
    const before = computeCycleEarn(card.cycleLines, card.rules, ancestors, options);
    const after = computeCycleEarn([...card.cycleLines, hypothetical], card.rules, ancestors, options);
    const points = Math.round((after.totalPoints - before.totalPoints) * 10) / 10;
    const r = card.bestRedemption;
    const valueMinor = r ? Math.floor((points * r.valueMinor) / r.perPoints) : null;
    const effectiveRateBps = r && valueMinor !== null && r.currency === query.currency ? Math.round((valueMinor * 10_000) / query.amountMinor) : null;

    let compareUnits: number | null;
    if (target.kind === 'value') compareUnits = valueMinor;
    else if (card.programName === target.program) compareUnits = points;
    else {
      const partner = partnerFor(card.transferPartners ?? [], target.program, query.occurredOn);
      compareUnits = partner ? estimatePartnerUnits(points, partner) : null;
    }

    const capHeadroom = card.rules
      .filter((rule) => rule.capSpendMinor !== null && ruleMatches(rule, hypothetical, ancestors, query.amountMinor, card.currency))
      .map((rule) => ({ ruleId: rule.id, ruleName: rule.name, remainingMinor: Math.max(0, rule.capSpendMinor! - (before.spendByRule[rule.id] ?? 0)) }));
    return {
      cardAccountId: card.cardAccountId,
      cardName: card.cardName,
      eligible: true,
      points,
      valueMinor,
      valueCurrency: r?.currency ?? null,
      effectiveRateBps,
      comparable: compareUnits !== null,
      compareUnits,
      capHeadroom,
    };
  });
  return results.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      Number(b.comparable) - Number(a.comparable) ||
      (b.compareUnits ?? -1) - (a.compareUnits ?? -1) ||
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
