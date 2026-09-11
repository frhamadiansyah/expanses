import type { CatalogEntry, CatalogFeePeriod, CatalogTermsPeriod } from './types';

export interface Period {
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export const withinPeriod = (date: string, { effectiveFrom, effectiveTo }: Period) =>
  (!effectiveFrom || date >= effectiveFrom) && (!effectiveTo || date <= effectiveTo);

export function termsOn(entry: CatalogEntry, date: string): CatalogTermsPeriod | null {
  return entry.terms.find((period) => withinPeriod(date, period)) ?? null;
}

export function feeOn(entry: CatalogEntry, date: string): CatalogFeePeriod | null {
  return entry.fees.find((fee) => withinPeriod(date, fee)) ?? null;
}

/** True when the entry was last verified more than maxAgeDays before today. */
export function isStale(entry: CatalogEntry, today: string, maxAgeDays = 180): boolean {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.verifiedOn}T00:00:00Z`)) / 86_400_000;
  return days > maxAgeDays;
}
