export type Rounding = 'per_transaction_floor' | 'per_cycle_sum';

export interface RuleMatch {
  /** Matches the category or any descendant. Empty = all categories. */
  categoryIds?: string[];
  excludeCategoryIds?: string[];
  /** Case-insensitive substrings of the description. Empty = any merchant. */
  merchantPatterns?: string[];
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
  minTransactionMinor: number | null;
  validFrom: string | null;
  validTo: string | null;
}

/** One expense entry charged to the card within the cycle, in the card currency. */
export interface SpendLine {
  transactionId: string;
  entryId: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  amountMinor: number;
  currency: string;
}

export interface EarnAllocation {
  transactionId: string;
  entryId: string;
  ruleId: string;
  spendMinor: number;
  points: number;
}

export interface CycleEarn {
  allocations: EarnAllocation[];
  pointsByRule: Record<string, number>;
  spendByRule: Record<string, number>;
  totalPoints: number;
  /** Spend no primary rule earned on (no match or all caps exhausted). */
  unearnedSpendMinor: number;
}

const floorDiv = (a: number, b: number) => (a - (a % b)) / b;

export function ruleMatches(rule: EarnRule, line: SpendLine, ancestors: Record<string, string[]>): boolean {
  if (rule.validFrom && line.occurredOn < rule.validFrom) return false;
  if (rule.validTo && line.occurredOn > rule.validTo) return false;
  if (rule.minTransactionMinor !== null && line.amountMinor < rule.minTransactionMinor) return false;
  const chain = [line.categoryId, ...(ancestors[line.categoryId] ?? [])];
  const m = rule.match;
  if (m.categoryIds?.length && !m.categoryIds.some((id) => chain.includes(id))) return false;
  if (m.excludeCategoryIds?.some((id) => chain.includes(id))) return false;
  const patterns = (m.merchantPatterns ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (patterns.length && !patterns.some((p) => line.description.toLowerCase().includes(p))) return false;
  if (m.currencies?.length && !m.currencies.includes(line.currency)) return false;
  return true;
}

/**
 * Deterministic points for one cycle. Lines are processed in date order; each line's spend cascades through
 * matching primary rules by priority, consuming cap headroom, so spend beyond a bonus cap falls to the next rule.
 * Recomputing the whole cycle makes voids, edits, and backdating correct without stored state.
 */
export function computeCycleEarn(lines: SpendLine[], rules: EarnRule[], ancestors: Record<string, string[]>): CycleEarn {
  const sorted = lines
    .filter((l) => l.amountMinor > 0)
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId) || a.entryId.localeCompare(b.entryId));
  const byPriority = (a: EarnRule, b: EarnRule) => b.priority - a.priority || a.id.localeCompare(b.id);
  const primary = rules.filter((r) => !r.stackable).sort(byPriority);
  const stackable = rules.filter((r) => r.stackable).sort(byPriority);

  const spendByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const pointsByRule: Record<string, number> = Object.fromEntries(rules.map((r) => [r.id, 0]));
  const allocations: EarnAllocation[] = [];
  let unearnedSpendMinor = 0;

  const allocate = (rule: EarnRule, line: SpendLine, wanted: number): number => {
    const used = spendByRule[rule.id]!;
    const headroom = rule.capSpendMinor === null ? wanted : Math.max(0, rule.capSpendMinor - used);
    const spend = Math.min(wanted, headroom);
    if (spend <= 0) return 0;
    spendByRule[rule.id] = used + spend;
    const before = pointsByRule[rule.id]!;
    let points =
      rule.rounding === 'per_cycle_sum'
        ? floorDiv((used + spend) * rule.rateNum, rule.rateDen) - floorDiv(used * rule.rateNum, rule.rateDen)
        : floorDiv(spend * rule.rateNum, rule.rateDen);
    if (rule.capPoints !== null) points = Math.max(0, Math.min(points, rule.capPoints - before));
    pointsByRule[rule.id] = before + points;
    allocations.push({ transactionId: line.transactionId, entryId: line.entryId, ruleId: rule.id, spendMinor: spend, points });
    return spend;
  };

  for (const line of sorted) {
    let remaining = line.amountMinor;
    for (const rule of primary) {
      if (remaining === 0) break;
      if (ruleMatches(rule, line, ancestors)) remaining -= allocate(rule, line, remaining);
    }
    unearnedSpendMinor += remaining;
    for (const rule of stackable) {
      if (ruleMatches(rule, line, ancestors)) allocate(rule, line, line.amountMinor);
    }
  }

  const totalPoints = Object.values(pointsByRule).reduce((s, p) => s + p, 0);
  return { allocations, pointsByRule, spendByRule, totalPoints, unearnedSpendMinor };
}
