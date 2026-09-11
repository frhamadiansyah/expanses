import infinite from '../entries/bca-sq-krisflyer-visa-infinite.json';
import signature from '../entries/bca-sq-krisflyer-visa-signature.json';
import unionpay from '../entries/bca-unionpay.json';
import cimbAccor from '../entries/cimb-niaga-world-all-accor.json';
import marriott from '../entries/mandiri-marriott-bonvoy.json';
import prioritas from '../entries/mandiri-world-prioritas.json';
import type { CatalogEntry } from './types';

export * from './types';
export { validateEntry } from './validate';
export { feeOn, isStale, termsOn } from './lookup';
export { type CatalogPlan, planCatalogApply, type PlannedBonus, type PlannedPartner, type PlannedRule } from './plan';
export { diffCatalogEntries } from './diff';
export { describeEntry } from './describe';
export { type BundledMerchant, MERCHANTS, type MerchantList, validateMerchants } from './merchants';

/** Bundled entries, validated in tests. JSON imports are widened to CatalogEntry after that validation. */
export const CATALOG: readonly CatalogEntry[] = [signature, infinite, unionpay, cimbAccor, prioritas, marriott] as unknown as CatalogEntry[];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}
