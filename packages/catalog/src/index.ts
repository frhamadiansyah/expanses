import infinite from '../entries/bca-sq-krisflyer-visa-infinite.json';
import signature from '../entries/bca-sq-krisflyer-visa-signature.json';
import unionpay from '../entries/bca-unionpay.json';
import cimbAccor from '../entries/cimb-niaga-world-all-accor.json';
import marriott from '../entries/mandiri-marriott-bonvoy.json';
import prioritas from '../entries/mandiri-world-prioritas.json';
import type { CatalogEntry, CatalogFeePeriod, CatalogTermsPeriod } from './types';

export * from './types';
export { validateEntry } from './validate';

/** Bundled entries, validated in tests. JSON imports are widened to CatalogEntry after that validation. */
export const CATALOG: readonly CatalogEntry[] = [signature, infinite, unionpay, cimbAccor, prioritas, marriott] as unknown as CatalogEntry[];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}

const within = (date: string, from: string | null, to: string | null) => (!from || date >= from) && (!to || date <= to);

export function termsOn(entry: CatalogEntry, date: string): CatalogTermsPeriod | null {
  return entry.terms.find((period) => within(date, period.effectiveFrom, period.effectiveTo)) ?? null;
}

export function feeOn(entry: CatalogEntry, date: string): CatalogFeePeriod | null {
  return entry.fees.find((fee) => within(date, fee.effectiveFrom, fee.effectiveTo)) ?? null;
}

/** True when the entry was last verified more than maxAgeDays before today. */
export function isStale(entry: CatalogEntry, today: string, maxAgeDays = 180): boolean {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${entry.verifiedOn}T00:00:00Z`)) / 86_400_000;
  return days > maxAgeDays;
}
