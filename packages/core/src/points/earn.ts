export type Rounding = 'per_transaction_floor' | 'per_cycle_sum';

export interface RuleMatch {
  /** Matches the category or any descendant. Empty = all categories. */
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  /** Case-insensitive substrings of the description. Empty = any merchant. */
  merchantPatterns?: string[];
  /** Case-insensitive description substrings that never earn under this rule. */
  excludeMerchantPatterns?: string[];
  /** Matches the currency the purchase was made in, falling back to the billed currency. */
  currencies?: string[];
}

export interface EarnRule {
  id: string;
  name: string;
  /** Higher runs first. */
  priority: number;
  /** Stackable rules earn on top of the primary cascade instead of consuming spend. */
  stackable: boolean;
  match: RuleMatch;
  /** rateNum points per rateDen minor units of spend. */
  rateNum: number;
  rateDen: number;
  rounding: Rounding;
  capSpendMinor: number | null;
  capPoints: number | null;
  /** Applies to the whole purchase, not to one category line of a split. */
  minTransactionMinor: number | null;
  validFrom: string | null;
  validTo: string | null;
}

/** One expense entry charged to the card within the cycle, in the card currency. Split purchases share a transactionId. */
export interface SpendLine {
  transactionId: string;
  entryId: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  amountMinor: number;
  currency: string;
  /** Currency the purchase was made in when it differs from the billed currency, e.g. SGD billed as IDR. */
  originalCurrency: string | null;
}

export interface EarnAllocation {
  transactionId: string;
  entryId: string;
  ruleId: string;
  spendMinor: number;
  points: number;
}

export interface BonusTier {
  minSpendMinor: number;
  bonus: number;
}

/** A lump sum awarded once per cycle for reaching a spend threshold; the highest tier reached pays. */
export interface CycleBonus {
  id: string;
  key: string;
  name: string;
  tiers: BonusTier[];
  match: RuleMatch;
  validFrom: string | null;
  validTo: string | null;
}

export interface CycleEarn {
  allocations: EarnAllocation[];
  pointsByRule: Record<string, number>;
  spendByRule: Record<string, number>;
  bonusById: Record<string, number>;
  eligibleSpendByBonus: Record<string, number>;
  /** Rule points plus bonuses. */
  totalPoints: number;
  /** Spend no primary rule earned on (no match, or every matching rule's cap exhausted). */
  unearnedSpendMinor: number;
}

const floorDiv = (a: number, b: number) => (a - (a % b)) / b;
const ceilDiv = (a: number, b: number) => floorDiv(a + b - 1, b);
const withinWindow = (date: string, from: string | null, to: string | null) => (!from || date >= from) && (!to || date <= to);

/** Category, merchant, and currency conditions shared by earn rules and cycle bonuses. */
export function matchesSpend(match: RuleMatch, line: SpendLine, ancestors: Record<string, string[]>): boolean {
  const chain = [line.categoryId, ...(ancestors[line.categoryId] ?? [])];
  if (match.categoryIds?.length && !match.categoryIds.some((id) => chain.includes(id))) return false;
  if (match.excludeCategoryIds?.some((id) => chain.includes(id))) return false;
  const description = line.description.toLowerCase();
  const patterns = (match.merchantPatterns ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length && !patterns.some((p) => description.includes(p))) return false;
  const excluded = (match.excludeMerchantPatterns ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (excluded.some((p) => description.includes(p))) return false;
  if (match.currencies?.length && !match.currencies.includes(line.originalCurrency ?? line.currency)) return false;
  return true;
}

export function ruleMatches(
  rule: EarnRule,
  line: SpendLine,
  ancestors: Record<string, string[]>,
  transactionTotalMinor: number = line.amountMinor,
): boolean {
  if (!withinWindow(line.occurredOn, rule.validFrom, rule.validTo)) return false;
  if (rule.minTransactionMinor !== null && transactionTotalMinor < rule.minTransactionMinor) return false;
  return matchesSpend(rule.match, line, ancestors);
}

/** The lowest tier not yet reached, or null when the top tier is reached. */
export function nextBonusTier(bonus: CycleBonus, eligibleSpendMinor: number): BonusTier | null {
  return [...bonus.tiers].sort((a, b) => a.minSpendMinor - b.minSpendMinor).find((t) => t.minSpendMinor > eligibleSpendMinor) ?? null;
}

/**
 * Deterministic points for one cycle. Purchases are processed in date order; each line's spend cascades through
 * matching primary rules by priority. A rule takes only the spend it can still reward — bounded by its spend cap and
 * by the spend that reaches its points cap — so the rest falls through to lower rules.
 * Rounding happens over the whole purchase (per_transaction_floor) or the whole cycle (per_cycle_sum), so split
 * purchases round like the issuer does. Cycle bonuses pay the highest tier reached by eligible spend, once, when the
 * bonus is valid at the end of the cycle. Recomputing the cycle makes voids, edits, and backdating correct.
 */
export function computeCycleEarn(
  lines: SpendLine[],
  rules: EarnRule[],
  ancestors: Record<string, string[]>,
  options: { bonuses?: CycleBonus[]; cycleEnd?: string } = {},
): CycleEarn {
  const sorted = lines
    .filter((l) => l.amountMinor > 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId) || a.entryId.localeCompare(b.entryId));
  const purchaseTotals = new Map<string, number>();
  for (const l of sorted) purchaseTotals.set(l.transactionId, (purchaseTotals.get(l.transactionId) ?? 0) + l.amountMinor);

  const byPriority = (a: EarnRule, b: EarnRule) => b.priority - a.priority || a.id.localeCompare(b.id);
  const primary = rules.filter((r) => !r.stackable).sort(byPriority);
  const stackable = rules.filter((r) => r.stackable).sort(byPriority);

  const spendByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const pointsByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  let purchaseSpendByRule: Record<string, number> = {};
  const allocations: EarnAllocation[] = [];
  let unearnedSpendMinor = 0;

  const pointsAt = (rule: EarnRule, spend: number) => floorDiv(spend * rule.rateNum, rule.rateDen);

  const allocate = (rule: EarnRule, line: SpendLine, wanted: number): number => {
    const cycleUsed = spendByRule[rule.id]!;
    const roundingBase = rule.rounding === 'per_cycle_sum' ? cycleUsed : (purchaseSpendByRule[rule.id] ?? 0);
    let headroom = rule.capSpendMinor === null ? wanted : Math.max(0, rule.capSpendMinor - cycleUsed);
    if (rule.capPoints !== null && rule.rateNum > 0) {
      const remaining = rule.capPoints - pointsByRule[rule.id]!;
      const spendToCap = remaining <= 0 ? 0 : ceilDiv((pointsAt(rule, roundingBase) + remaining) * rule.rateDen, rule.rateNum) - roundingBase;
      headroom = Math.min(headroom, Math.max(0, spendToCap));
    }
    const spend = Math.min(wanted, headroom);
    if (spend <= 0) return 0;
    spendByRule[rule.id] = cycleUsed + spend;
    purchaseSpendByRule[rule.id] = (purchaseSpendByRule[rule.id] ?? 0) + spend;
    let points = pointsAt(rule, roundingBase + spend) - pointsAt(rule, roundingBase);
    if (rule.capPoints !== null) points = Math.max(0, Math.min(points, rule.capPoints - pointsByRule[rule.id]!));
    pointsByRule[rule.id] = pointsByRule[rule.id]! + points;
    allocations.push({ transactionId: line.transactionId, entryId: line.entryId, ruleId: rule.id, spendMinor: spend, points });
    return spend;
  };

  let currentPurchase: string | null = null;
  for (const line of sorted) {
    if (line.transactionId !== currentPurchase) {
      currentPurchase = line.transactionId;
      purchaseSpendByRule = {};
    }
    const total = purchaseTotals.get(line.transactionId)!;
    let remaining = line.amountMinor;
    for (const rule of primary) {
      if (remaining === 0) break;
      if (ruleMatches(rule, line, ancestors, total)) remaining -= allocate(rule, line, remaining);
    }
    unearnedSpendMinor += remaining;
    for (const rule of stackable) {
      if (ruleMatches(rule, line, ancestors, total)) allocate(rule, line, line.amountMinor);
    }
  }

  const bonusById: Record<string, number> = {};
  const eligibleSpendByBonus: Record<string, number> = {};
  const cycleEnd = options.cycleEnd ?? sorted.at(-1)?.occurredOn ?? null;
  for (const bonus of options.bonuses ?? []) {
    const eligible = sorted
      .filter((l) => withinWindow(l.occurredOn, bonus.validFrom, bonus.validTo) && matchesSpend(bonus.match, l, ancestors))
      .reduce((s, l) => s + l.amountMinor, 0);
    eligibleSpendByBonus[bonus.id] = eligible;
    const active = cycleEnd !== null && withinWindow(cycleEnd, bonus.validFrom, bonus.validTo);
    const reached = [...bonus.tiers].sort((a, b) => a.minSpendMinor - b.minSpendMinor).filter((t) => t.minSpendMinor <= eligible).at(-1);
    bonusById[bonus.id] = active && reached ? reached.bonus : 0;
  }

  const totalPoints =
    Object.values(pointsByRule).reduce((s, p) => s + p, 0) + Object.values(bonusById).reduce((s, p) => s + p, 0);
  return { allocations, pointsByRule, spendByRule, bonusById, eligibleSpendByBonus, totalPoints, unearnedSpendMinor };
}
