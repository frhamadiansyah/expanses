import infinite from '../entries/bca-sq-krisflyer-visa-infinite.json';
import jenius from '../entries/jenius-kartu-kredit.json';
import signature from '../entries/bca-sq-krisflyer-visa-signature.json';
import unionpay from '../entries/bca-unionpay.json';
import bniGarudaPlatinum from '../entries/bni-garuda-visa-platinum.json';
import bniGarudaSignature from '../entries/bni-garuda-visa-signature.json';
import cimbAccor from '../entries/cimb-niaga-world-all-accor.json';
import danamonJcb from '../entries/danamon-jcb-precious.json';
import marriott from '../entries/mandiri-marriott-bonvoy.json';
import ocbc90n from '../entries/ocbc-90n.json';
import prioritas from '../entries/mandiri-world-prioritas.json';
import maybankBmw from '../entries/maybank-bmw.json';
import maybankInfinite from '../entries/maybank-visa-infinite.json';
import maybankManchesterUnited from '../entries/maybank-manchester-united.json';
import maybankMini from '../entries/maybank-mini.json';
import maybankPlatinum from '../entries/maybank-visa-platinum.json';
import type { CatalogEntry } from './types';

export * from './types';
export { validateEntry } from './validate';
export { feeOn, isStale, termsOn } from './lookup';
export { type AppliedCategoryChoice, type CatalogPlan, planCatalogApply, type PlannedBonus, type PlannedPartner, type PlannedRule } from './plan';
export { diffCatalogEntries } from './diff';
export { describeEntry } from './describe';
export { type BundledMerchant, MERCHANTS, type MerchantList, validateMerchants } from './merchants';

/** Bundled entries, validated in tests. JSON imports are widened to CatalogEntry after that validation. */
export const CATALOG: readonly CatalogEntry[] = [
  signature,
  infinite,
  unionpay,
  cimbAccor,
  prioritas,
  marriott,
  maybankPlatinum,
  maybankInfinite,
  maybankBmw,
  maybankMini,
  maybankManchesterUnited,
  jenius,
  danamonJcb,
  ocbc90n,
  bniGarudaSignature,
  bniGarudaPlatinum,
] as unknown as CatalogEntry[];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((entry) => entry.id === id);
}
