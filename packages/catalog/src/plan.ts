import type { CycleBonus, EarnRule, RuleMatch, TransferPartner } from '@expanses/core';
import { feeOn } from './lookup';
import type { CatalogEntry, CatalogMatch } from './types';

export interface PlannedRule extends Omit<EarnRule, 'id'> {
  catalogKey: string;
}

export interface PlannedBonus extends Omit<CycleBonus, 'id'> {
  catalogKey: string;
}

export interface PlannedPartner extends Omit<TransferPartner, 'id'> {
  catalogKey: string;
}

export interface CatalogPlan {
  program: CatalogEntry['program'];
  rules: PlannedRule[];
  bonuses: PlannedBonus[];
  transferPartners: PlannedPartner[];
  cashValue: CatalogEntry['cashValue'];
  crediting: 'per_transaction' | 'per_statement';
  /** Fee in force today, or null when the entry publishes none. */
  annualFeeMinor: number | null;
  /** Category keys with no matching category in the workspace, sorted. */
  unmappedKeys: string[];
}

/**
 * Expands an entry into rows for storage. Each terms period becomes rows valid for exactly that period, so applying
 * or updating an entry never changes how past cycles compute. Rules and bonuses are keyed `<period start>:<key>`,
 * partners by their key.
 */
export function planCatalogApply(entry: CatalogEntry, categoryIdsByKey: Record<string, string>, today: string): CatalogPlan {
  const unmapped = new Set<string>();
  const ids = (keys: readonly string[] | undefined) =>
    (keys ?? []).flatMap((key) => {
      const id = categoryIdsByKey[key];
      if (id === undefined) unmapped.add(key);
      return id === undefined ? [] : [id];
    });

  /** Null when the match is limited to categories of which none exist: an empty list would match every category. */
  const toMatch = (match: CatalogMatch): RuleMatch | null => {
    const categoryIds = ids(match.categoryKeys);
    const excludeCategoryIds = ids(match.excludeCategoryKeys);
    if (match.categoryKeys?.length && categoryIds.length === 0) return null;
    const result: RuleMatch = {};
    if (categoryIds.length) result.categoryIds = categoryIds;
    if (excludeCategoryIds.length) result.excludeCategoryIds = excludeCategoryIds;
    if (match.merchantPatterns) result.merchantPatterns = [...match.merchantPatterns];
    if (match.excludeMerchantPatterns) result.excludeMerchantPatterns = [...match.excludeMerchantPatterns];
    if (match.currencies) result.currencies = [...match.currencies];
    if (match.origin) result.origin = match.origin;
    if (match.mccs) result.mccs = [...match.mccs];
    if (match.excludeMccs) result.excludeMccs = [...match.excludeMccs];
    return result;
  };

  const rules: PlannedRule[] = [];
  const bonuses: PlannedBonus[] = [];
  for (const period of entry.terms) {
    const start = period.effectiveFrom ?? 'start';
    for (const rule of period.rules) {
      const match = toMatch(rule.match);
      if (!match) continue;
      rules.push({
        catalogKey: `${start}:${rule.key}`,
        name: rule.name,
        priority: rule.priority,
        stackable: rule.stackable,
        match,
        rateNum: rule.rateNum,
        rateDen: rule.rateDen,
        rounding: rule.rounding,
        capSpendMinor: rule.capSpendMinor ?? null,
        capPoints: rule.capPoints ?? null,
        minTransactionMinor: rule.minTransactionMinor ?? null,
        validFrom: period.effectiveFrom,
        validTo: period.effectiveTo,
      });
    }
    for (const bonus of period.cycleBonuses) {
      const match = toMatch(bonus.match);
      if (!match) continue;
      bonuses.push({
        catalogKey: `${start}:${bonus.key}`,
        key: bonus.key,
        name: bonus.name,
        tiers: bonus.tiers.map((tier) => ({ ...tier })),
        match,
        validFrom: period.effectiveFrom,
        validTo: period.effectiveTo,
      });
    }
  }

  return {
    program: { ...entry.program },
    rules,
    bonuses,
    transferPartners: entry.transferPartners.map((partner) => ({
      catalogKey: partner.key,
      key: partner.key,
      program: partner.program,
      points: partner.points,
      partnerUnits: partner.partnerUnits,
      incrementPoints: partner.incrementPoints,
      validFrom: partner.effectiveFrom,
      validTo: partner.effectiveTo,
    })),
    cashValue: entry.cashValue ? { ...entry.cashValue } : null,
    crediting: entry.program.crediting ?? 'per_statement',
    annualFeeMinor: feeOn(entry, today)?.annualFeeMinor ?? null,
    unmappedKeys: [...unmapped].sort(),
  };
}
