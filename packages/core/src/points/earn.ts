/**
 * per_transaction_floor: floor(spend × rate) per purchase. per_cycle_sum: floor over the cycle total.
 * per_increment: floor(purchase spend ÷ rateDen) × rateNum — earning per whole spend multiple, rateNum may be fractional.
 */
export type Rounding = 'per_transaction_floor' | 'per_cycle_sum' | 'per_increment';

export interface RuleMatch {
  /** Matches the category or any descendant. Empty = all categories. */
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  /** Whole-word, case-insensitive keywords in the description. Empty = any merchant. */
  merchantPatterns?: string[];
  /** Whole-word, case-insensitive description keywords that never earn under this rule. */
  excludeMerchantPatterns?: string[];
  /** Matches the currency the purchase was made in, falling back to the billed currency. */
  currencies?: string[];
  /** Foreign: spent in a currency other than the card's billing currency. Domestic: spent in the billing currency. */
  origin?: 'domestic' | 'foreign';
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

export interface EarnOptions {
  bonuses?: CycleBonus[];
  cycleEnd?: string;
  /** The card's billing currency, used to decide domestic or foreign origin. Defaults to IDR. */
  billingCurrency?: string;
}

const floorDiv = (a: number, b: number) => (a - (a % b)) / b;
const ceilDiv = (a: number, b: number) => floorDiv(a + b - 1, b);
const withinWindow = (date: string, from: string | null, to: string | null) => (!from || date >= from) && (!to || date <= to);
const TENTHS = 10;
const rateTenths = (rule: EarnRule) => Math.round(rule.rateNum * TENTHS);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/** Case-insensitive keyword or phrase match that must not touch letters or digits on either side. */
export function containsKeyword(description: string, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return false;
  const haystack = description.toLowerCase();
  let from = 0;
  let i: number;
  while ((i = haystack.indexOf(needle, from)) >= 0) {
    if (!isWordChar(haystack[i - 1]) && !isWordChar(haystack[i + needle.length])) return true;
    from = i + 1;
  }
  return false;
}

/** Category, merchant, currency, and origin conditions shared by earn rules and cycle bonuses. */
export function matchesSpend(match: RuleMatch, line: SpendLine, ancestors: Record<string, string[]>, billingCurrency = 'IDR'): boolean {
  const chain = [line.categoryId, ...(ancestors[line.categoryId] ?? [])];
  if (match.categoryIds?.length && !match.categoryIds.some((id) => chain.includes(id))) return false;
  if (match.excludeCategoryIds?.some((id) => chain.includes(id))) return false;
  const include = (match.merchantPatterns ?? []).filter((p) => p.trim());
  if (include.length && !include.some((p) => containsKeyword(line.description, p))) return false;
  if ((match.excludeMerchantPatterns ?? []).some((p) => containsKeyword(line.description, p))) return false;
  const spentIn = line.originalCurrency ?? line.currency;
  if (match.currencies?.length && !match.currencies.includes(spentIn)) return false;
  if (match.origin === 'foreign' && spentIn === billingCurrency) return false;
  if (match.origin === 'domestic' && spentIn !== billingCurrency) return false;
  return true;
}

export function ruleMatches(
  rule: EarnRule,
  line: SpendLine,
  ancestors: Record<string, string[]>,
  transactionTotalMinor: number = line.amountMinor,
  billingCurrency = 'IDR',
): boolean {
  if (!withinWindow(line.occurredOn, rule.validFrom, rule.validTo)) return false;
  if (rule.minTransactionMinor !== null && transactionTotalMinor < rule.minTransactionMinor) return false;
  return matchesSpend(rule.match, line, ancestors, billingCurrency);
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
export function computeCycleEarn(lines: SpendLine[], rules: EarnRule[], ancestors: Record<string, string[]>, options: EarnOptions = {}): CycleEarn {
  const billingCurrency = options.billingCurrency ?? 'IDR';
  const sorted = lines
    .filter((l) => l.amountMinor > 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId) || a.entryId.localeCompare(b.entryId));
  const purchaseTotals = new Map<string, number>();
  for (const l of sorted) purchaseTotals.set(l.transactionId, (purchaseTotals.get(l.transactionId) ?? 0) + l.amountMinor);

  const byPriority = (a: EarnRule, b: EarnRule) => b.priority - a.priority || a.id.localeCompare(b.id);
  const primary = rules.filter((r) => !r.stackable).sort(byPriority);
  const stackable = rules.filter((r) => r.stackable).sort(byPriority);

  const spendByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  // Points are tracked in integer tenths so half points (e.g. 7,5 per multiple) sum exactly.
  const tenthsByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  let purchaseSpendByRule: Record<string, number> = {};
  const allocations: EarnAllocation[] = [];
  let unearnedSpendMinor = 0;

  const tenthsAt = (rule: EarnRule, spend: number) =>
    rule.rounding === 'per_increment'
      ? floorDiv(spend, rule.rateDen) * rateTenths(rule)
      : floorDiv(spend * rateTenths(rule), rule.rateDen * TENTHS) * TENTHS;

  const spendToReachTenths = (rule: EarnRule, base: number, extraTenths: number): number => {
    const rt = rateTenths(rule);
    if (rule.rounding === 'per_increment') return (floorDiv(base, rule.rateDen) + ceilDiv(extraTenths, rt)) * rule.rateDen - base;
    const wholePoints = floorDiv(tenthsAt(rule, base), TENTHS) + ceilDiv(extraTenths, TENTHS);
    return ceilDiv(wholePoints * rule.rateDen * TENTHS, rt) - base;
  };

  const allocate = (rule: EarnRule, line: SpendLine, wanted: number): number => {
    const cycleUsed = spendByRule[rule.id]!;
    const roundingBase = rule.rounding === 'per_cycle_sum' ? cycleUsed : (purchaseSpendByRule[rule.id] ?? 0);
    let headroom = rule.capSpendMinor === null ? wanted : Math.max(0, rule.capSpendMinor - cycleUsed);
    if (rule.capPoints !== null && rateTenths(rule) > 0) {
      const remainingTenths = rule.capPoints * TENTHS - tenthsByRule[rule.id]!;
      const spendToCap = remainingTenths <= 0 ? 0 : spendToReachTenths(rule, roundingBase, remainingTenths);
      headroom = Math.min(headroom, Math.max(0, spendToCap));
    }
    const spend = Math.min(wanted, headroom);
    if (spend <= 0) return 0;
    spendByRule[rule.id] = cycleUsed + spend;
    purchaseSpendByRule[rule.id] = (purchaseSpendByRule[rule.id] ?? 0) + spend;
    let tenths = tenthsAt(rule, roundingBase + spend) - tenthsAt(rule, roundingBase);
    if (rule.capPoints !== null) tenths = Math.max(0, Math.min(tenths, rule.capPoints * TENTHS - tenthsByRule[rule.id]!));
    tenthsByRule[rule.id] = tenthsByRule[rule.id]! + tenths;
    allocations.push({ transactionId: line.transactionId, entryId: line.entryId, ruleId: rule.id, spendMinor: spend, points: tenths / TENTHS });
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
      if (ruleMatches(rule, line, ancestors, total, billingCurrency)) remaining -= allocate(rule, line, remaining);
    }
    unearnedSpendMinor += remaining;
    for (const rule of stackable) {
      if (ruleMatches(rule, line, ancestors, total, billingCurrency)) allocate(rule, line, line.amountMinor);
    }
  }

  const bonusById: Record<string, number> = {};
  const eligibleSpendByBonus: Record<string, number> = {};
  const cycleEnd = options.cycleEnd ?? sorted.at(-1)?.occurredOn ?? null;
  for (const bonus of options.bonuses ?? []) {
    const eligible = sorted
      .filter((l) => withinWindow(l.occurredOn, bonus.validFrom, bonus.validTo) && matchesSpend(bonus.match, l, ancestors, billingCurrency))
      .reduce((s, l) => s + l.amountMinor, 0);
    eligibleSpendByBonus[bonus.id] = eligible;
    const active = cycleEnd !== null && withinWindow(cycleEnd, bonus.validFrom, bonus.validTo);
    const reached = [...bonus.tiers].sort((a, b) => a.minSpendMinor - b.minSpendMinor).filter((t) => t.minSpendMinor <= eligible).at(-1);
    bonusById[bonus.id] = active && reached ? reached.bonus : 0;
  }

  const pointsByRule = Object.fromEntries(Object.entries(tenthsByRule).map(([id, t]) => [id, t / TENTHS]));
  const totalTenths = Object.values(tenthsByRule).reduce((s, t) => s + t, 0) + Object.values(bonusById).reduce((s, b) => s + b * TENTHS, 0);
  const totalPoints = totalTenths / TENTHS;
  return { allocations, pointsByRule, spendByRule, bonusById, eligibleSpendByBonus, totalPoints, unearnedSpendMinor };
}
