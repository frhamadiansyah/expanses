import type { CycleBonus, EarnRule, RedemptionCap, RuleMatch, TransferPartner } from '@expanses/core';
import { feeOn } from './lookup';
import type { CatalogEntry, CatalogMatch, CatalogRedemptionCap } from './types';

/** Fills in the defaults the entry leaves out: a cap is per-partner and hard unless it says otherwise. */
function redemptionCap(cap: CatalogRedemptionCap | undefined): RedemptionCap | null {
  if (!cap) return null;
  const beyond = cap.beyondPoints && cap.beyondPartnerUnits ? { points: cap.beyondPoints, partnerUnits: cap.beyondPartnerUnits } : null;
  return {
    window: cap.window,
    capPoints: cap.capPoints ?? null,
    capPartnerUnits: cap.capPartnerUnits ?? null,
    shared: cap.shared ?? false,
    beyond,
  };
}

/** A stretch of time the holder ran one option of the program's category choice. `to` null means it still runs. */
export interface AppliedCategoryChoice {
  optionKey: string;
  from: string | null;
  to: string | null;
}

/** The later of two starts, and the earlier of two ends, with null meaning open. Null when they do not overlap. */
function overlap(a: { from: string | null; to: string | null }, b: { from: string | null; to: string | null }) {
  const from = a.from === null ? b.from : b.from === null ? a.from : a.from > b.from ? a.from : b.from;
  const to = a.to === null ? b.to : b.to === null ? a.to : a.to < b.to ? a.to : b.to;
  return from !== null && to !== null && from > to ? null : { from, to };
}

export interface PlannedRule extends Omit<EarnRule, 'id'> {
  catalogKey: string;
  /** Set when the rule's spend cap is the card's credit limit, which only the card's own terms can supply. */
  capSpendAtCreditLimit?: boolean;
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
  /** True when the entry publishes member levels, so the card must record which one the holder is on. */
  requiresMemberLevel: boolean;
  /** The level this plan was expanded at, or null when none was chosen. */
  memberLevel: string | null;
  /** True when the entry publishes a category choice, so the card must record which option is running. */
  requiresCategoryChoice: boolean;
}

/**
 * Expands an entry into rows for storage. Each terms period becomes rows valid for exactly that period, so applying
 * or updating an entry never changes how past cycles compute. Rules and bonuses are keyed `<period start>:<key>`,
 * partners by their key.
 */
export function planCatalogApply(
  entry: CatalogEntry,
  categoryIdsByKey: Record<string, string>,
  today: string,
  memberLevel?: string | null,
  categoryChoices: readonly AppliedCategoryChoice[] = [],
): CatalogPlan {
  const unmapped = new Set<string>();
  /** A row with no levels applies at every level; one that names levels needs the chosen level among them. */
  const atLevel = (levels: readonly string[] | undefined) => !levels || (!!memberLevel && levels.includes(memberLevel));
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
      if (!atLevel(rule.memberLevels)) continue;
      const shape = {
        name: rule.name,
        priority: rule.priority,
        stackable: rule.stackable,
        rateNum: rule.rateNum,
        rateDen: rule.rateDen,
        rounding: rule.rounding,
        capSpendMinor: rule.capSpendMinor ?? null,
        capPoints: rule.capPoints ?? null,
        minTransactionMinor: rule.minTransactionMinor ?? null,
        minCycleSpendMinor: rule.minCycleSpendMinor ?? null,
        ...(rule.capSpendAtCreditLimit ? { capSpendAtCreditLimit: true } : {}),
      };

      // A rule tied to the category choice becomes one dated row per stretch the holder ran an option, so a
      // cycle that closed keeps the category that was running while it ran.
      if (rule.categoryChoice) {
        const choice = entry.program.categoryChoice;
        if (!choice || choice.key !== rule.categoryChoice) continue;
        for (const applied of categoryChoices) {
          const option = choice.options.find((candidate) => candidate.key === applied.optionKey);
          if (!option) continue;
          const window = overlap({ from: period.effectiveFrom, to: period.effectiveTo }, { from: applied.from, to: applied.to });
          if (!window) continue;
          const match = toMatch({ ...rule.match, ...option.match });
          if (!match) continue;
          rules.push({
            ...shape,
            catalogKey: `${start}:${rule.key}:${option.key}:${applied.from ?? 'start'}`,
            name: `${rule.name}: ${option.name}`,
            match,
            validFrom: window.from,
            validTo: window.to,
          });
        }
        continue;
      }

      const match = toMatch(rule.match);
      if (!match) continue;
      rules.push({
        ...shape,
        catalogKey: `${start}:${rule.key}`,
        match,
        validFrom: period.effectiveFrom,
        validTo: period.effectiveTo,
      });
    }
    for (const bonus of period.cycleBonuses) {
      if (!atLevel(bonus.memberLevels)) continue;
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
    transferPartners: entry.transferPartners.filter((partner) => atLevel(partner.memberLevels)).map((partner) => ({
      catalogKey: partner.key,
      key: partner.key,
      program: partner.program,
      points: partner.points,
      partnerUnits: partner.partnerUnits,
      incrementPoints: partner.incrementPoints,
      minimumPoints: partner.minimumPoints ?? null,
      validFrom: partner.effectiveFrom,
      validTo: partner.effectiveTo,
      cap: redemptionCap(partner.cap),
    })),
    cashValue: entry.cashValue ? { ...entry.cashValue } : null,
    crediting: entry.program.crediting ?? 'per_statement',
    annualFeeMinor: feeOn(entry, today)?.annualFeeMinor ?? null,
    unmappedKeys: [...unmapped].sort(),
    requiresMemberLevel: (entry.program.memberLevels?.length ?? 0) > 0,
    memberLevel: memberLevel ?? null,
    requiresCategoryChoice: !!entry.program.categoryChoice,
  };
}
