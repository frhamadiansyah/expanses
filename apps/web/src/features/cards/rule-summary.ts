import type { RuleMatch } from '@expanses/core';

/** MCC specs listed in full up to this many; beyond it the rest are counted. */
const MCC_SHOWN = 4;

/**
 * What narrows a rule, in words, for the line under its name. Empty means the rule matches every purchase,
 * which the caller says as "all categories". An MCC or origin rule is not "all categories": it just does not
 * narrow by the workspace's own categories.
 */
export function ruleQualifiers(match: RuleMatch, categoryName: (id: string) => string): string[] {
  const parts: string[] = [];
  if (match.categoryIds?.length) parts.push(match.categoryIds.map(categoryName).join(', '));
  if (match.mccs?.length) {
    const shown = match.mccs.slice(0, MCC_SHOWN).join(', ');
    const rest = match.mccs.length - MCC_SHOWN;
    parts.push(`MCC ${shown}${rest > 0 ? ` and ${rest} more` : ''}`);
  }
  if (match.origin === 'foreign') parts.push('spent abroad');
  if (match.origin === 'domestic') parts.push('spent at home');
  if (match.currencies?.length) parts.push(`in ${match.currencies.join(', ')}`);
  if (match.merchantPatterns?.length) parts.push(`merchants: ${match.merchantPatterns.join(', ')}`);
  return parts;
}
