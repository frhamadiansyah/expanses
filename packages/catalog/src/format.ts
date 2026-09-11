import { type BonusTier, DEFAULT_CATEGORIES, formatMinor, mccName } from '@expanses/core';
import type { Period } from './lookup';
import type { CatalogEntry, CatalogFeePeriod, CatalogMatch, CatalogRule, CatalogTransferPartner } from './types';

const CATEGORY_NAMES = new Map<string, string>(
  DEFAULT_CATEGORIES.flatMap((category) => [
    [category.key, category.name] as [string, string],
    ...(category.children ?? []).map((child): [string, string] => [child.key, child.name]),
  ]),
);

export const categoryNames = (keys: readonly string[]) => keys.map((key) => CATEGORY_NAMES.get(key) ?? key).join(', ');

/** "MCC 5814 Fast Food Restaurants" for codes, "MCC 3000–3299" for ranges. */
export const mccList = (specs: readonly string[]) =>
  specs
    .map((spec) => {
      const [start, end] = spec.split('-');
      if (end) return `MCC ${start}–${end}`;
      const name = mccName(spec);
      return name ? `MCC ${spec} ${name}` : `MCC ${spec}`;
    })
    .join(', ');

export const creditingText = (crediting: 'per_transaction' | 'per_statement' | undefined) => ((crediting ?? 'per_statement') === 'per_transaction' ? 'per purchase' : 'per statement');

/** Plain spaces instead of Intl's no-break spaces, so copy reads the same everywhere. */
export const money = (amountMinor: number, currency: string) => formatMinor(amountMinor, currency).replace(/\s/g, ' ');

const COUNT = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
export const count = (value: number) => COUNT.format(value);

export const unitWord = (entry: CatalogEntry, value: number) =>
  entry.program.unit === 'miles' ? (value === 1 ? 'mile' : 'miles') : value === 1 ? 'point' : 'points';

export const amountOf = (entry: CatalogEntry, value: number) => `${count(value)} ${unitWord(entry, value)}`;

export const cycleText = (entry: CatalogEntry) => (entry.program.cycleAnchor === 'statement' ? 'statement cycle' : 'calendar month');

export function periodLabel({ effectiveFrom: from, effectiveTo: to }: Period): string {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return 'always';
}

export function rateText(entry: CatalogEntry, rule: Pick<CatalogRule, 'rateNum' | 'rateDen' | 'rounding'>): string {
  const earn = amountOf(entry, rule.rateNum);
  const spend = money(rule.rateDen, entry.currency);
  if (rule.rounding === 'per_increment') return `${earn} per full ${spend}`;
  if (rule.rounding === 'per_cycle_sum') return `${earn} per ${spend}, rounded down on the cycle total`;
  return `${earn} per ${spend}, rounded down per purchase`;
}

export const originText = (entry: CatalogEntry, origin: 'domestic' | 'foreign') =>
  origin === 'foreign' ? `spent in a currency other than ${entry.currency}` : `spent in ${entry.currency}`;

export function conditionParts(entry: CatalogEntry, match: CatalogMatch): string[] {
  const parts: string[] = [];
  if (match.categoryKeys?.length) parts.push(`in ${categoryNames(match.categoryKeys)}`);
  if (match.merchantPatterns?.length) parts.push(`at merchants matching ${match.merchantPatterns.join(', ')}`);
  if (match.mccs?.length) parts.push(`at ${mccList(match.mccs)}`);
  if (match.currencies?.length) parts.push(`spent in ${match.currencies.join(', ')}`);
  if (match.origin) parts.push(originText(entry, match.origin));
  return parts;
}

export function exclusionText(match: CatalogMatch): string {
  const parts: string[] = [];
  if (match.excludeCategoryKeys?.length) parts.push(categoryNames(match.excludeCategoryKeys));
  if (match.excludeMerchantPatterns?.length) parts.push(`merchants matching ${match.excludeMerchantPatterns.join(', ')}`);
  if (match.excludeMccs?.length) parts.push(mccList(match.excludeMccs));
  return parts.join('; ');
}

export function limitText(entry: CatalogEntry, field: 'minTransactionMinor' | 'capSpendMinor' | 'capPoints', value: number | null): string {
  if (value === null) return 'none';
  return field === 'capPoints' ? amountOf(entry, value) : money(value, entry.currency);
}

export function limitParts(entry: CatalogEntry, rule: CatalogRule): string[] {
  const parts: string[] = [];
  const cycle = cycleText(entry);
  if (rule.minTransactionMinor != null) parts.push(`purchases of at least ${limitText(entry, 'minTransactionMinor', rule.minTransactionMinor)}`);
  if (rule.capSpendMinor != null) parts.push(`up to ${limitText(entry, 'capSpendMinor', rule.capSpendMinor)} spent per ${cycle}`);
  if (rule.capPoints != null) parts.push(`up to ${limitText(entry, 'capPoints', rule.capPoints)} per ${cycle}`);
  return parts;
}

export const tiersText = (entry: CatalogEntry, tiers: readonly BonusTier[]) =>
  tiers.map((tier) => `${amountOf(entry, tier.bonus)} from ${money(tier.minSpendMinor, entry.currency)} spent`).join(', ');

export function feeText(entry: CatalogEntry, fee: CatalogFeePeriod): string {
  const supplementary = fee.supplementaryFeeMinor === null ? '' : `, supplementary ${money(fee.supplementaryFeeMinor, entry.currency)}`;
  return `${money(fee.annualFeeMinor, entry.currency)}${supplementary}${fee.condition ? ` (${fee.condition})` : ''}`;
}

export const ratioText = (partner: Pick<CatalogTransferPartner, 'points' | 'partnerUnits' | 'incrementPoints'>) =>
  `${count(partner.points)} = ${count(partner.partnerUnits)}, in steps of ${count(partner.incrementPoints)}`;

export const cashValueText = (entry: CatalogEntry, cash: CatalogEntry['cashValue']) =>
  cash ? `${money(cash.valueMinor, cash.currency)} per ${amountOf(entry, cash.perPoints)}` : 'none';
