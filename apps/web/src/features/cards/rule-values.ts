import type { RuleMatch } from '@expanses/core';
/** Earn rates may carry one decimal (7,5 points per Rp 50.000). Accepts a comma or a dot; empty means not entered. */
export function parseRulePoints(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d)?$/.test(normalized)) throw new Error(`"${trimmed}" must be a number of points with at most one decimal, like 3 or 7,5`);
  return Number(normalized);
}

/** The parts of a match this app's forms let you edit. Everything else is carried through untouched. */
export interface EditableMatch {
  categoryIds: string[];
  excludeCategoryIds: string[];
  merchantPatterns: string[];
}

/**
 * Applies the fields a form edits without disturbing the rest.
 *
 * A catalogue entry carries conditions no form shows — excluded MCCs, excluded merchant keywords,
 * currency and origin. Rebuilding the match from the visible inputs would drop them silently, and a
 * KrisFlyer bonus would quietly start counting electricity bills. So the untouched parts are kept and
 * only the three the form owns are replaced; emptying one removes it rather than storing an empty list.
 */
export function mergeMatch(initial: RuleMatch | undefined, edited: EditableMatch): RuleMatch {
  const kept: RuleMatch = { ...initial };
  delete kept.categoryIds;
  delete kept.excludeCategoryIds;
  delete kept.merchantPatterns;
  return {
    ...kept,
    ...(edited.categoryIds.length ? { categoryIds: edited.categoryIds } : {}),
    ...(edited.excludeCategoryIds.length ? { excludeCategoryIds: edited.excludeCategoryIds } : {}),
    ...(edited.merchantPatterns.length ? { merchantPatterns: edited.merchantPatterns } : {}),
  };
}
