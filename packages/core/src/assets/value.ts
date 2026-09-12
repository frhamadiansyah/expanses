import type { Position } from './position';
import { unitsValueMinor } from './units';

export type ValuationMode = 'derived' | 'snapshot' | 'market';
export type ValuationBasis = 'estimate' | 'appraisal' | 'listing' | 'njop' | 'purchase';

export interface PriceRow {
  onDate: string;
  priceMicro: number;
}

export interface ValuationRow {
  asOf: string;
  valueMinor: number;
  basis: ValuationBasis;
}

export interface AssetValueInput {
  accountId: string;
  mode: ValuationMode;
  currency: string;
  /** Balance of the account in the ledger on the date asked for: cost for holdings, money held for cash accounts. */
  ledgerBalanceMinor: number;
  /** Units and cost on the date asked for. Market mode only. */
  position?: Position;
  prices?: PriceRow[];
  valuations?: ValuationRow[];
}

export interface AssetValue {
  accountId: string;
  valueMinor: number;
  costMinor: number;
  source: 'ledger' | 'price' | 'valuation' | 'cost';
  /** Date of the price or estimate used, or null when the value comes from the ledger. */
  asOf: string | null;
}

export const PRICE_STALE_DAYS = 30;
export const VALUATION_STALE_DAYS = 365;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function latest<T>(rows: T[], dateOf: (row: T) => string, onOrBefore: string): T | undefined {
  let best: T | undefined;
  for (const row of rows) {
    if (dateOf(row) > onOrBefore) continue;
    if (!best || dateOf(row) > dateOf(best)) best = row;
  }
  return best;
}

/** What an asset is worth on a date: ledger balance, units × price, or the latest estimate. */
export function assetValueAt(input: AssetValueInput, date: string): AssetValue {
  const { accountId } = input;
  if (input.mode === 'derived') {
    return { accountId, valueMinor: input.ledgerBalanceMinor, costMinor: input.ledgerBalanceMinor, source: 'ledger', asOf: null };
  }
  const costMinor = input.mode === 'market' ? (input.position?.costMinor ?? 0) : input.ledgerBalanceMinor;
  if (input.mode === 'market') {
    const price = latest(input.prices ?? [], (p) => p.onDate, date);
    if (!price) return { accountId, valueMinor: costMinor, costMinor, source: 'cost', asOf: null };
    return { accountId, valueMinor: unitsValueMinor(input.position?.unitsMicro ?? 0, price.priceMicro), costMinor, source: 'price', asOf: price.onDate };
  }
  // Snapshot: NJOP is kept for the tax report, never used as the value in the plan.
  const valuation = latest((input.valuations ?? []).filter((v) => v.basis !== 'njop'), (v) => v.asOf, date);
  if (!valuation) return { accountId, valueMinor: costMinor, costMinor, source: 'cost', asOf: null };
  return { accountId, valueMinor: valuation.valueMinor, costMinor, source: 'valuation', asOf: valuation.asOf };
}

/** True when the owner should type a fresh price or estimate. */
export function isStaleValue(value: AssetValue, date: string): boolean {
  if (value.source === 'ledger') return false;
  if (value.source === 'cost') return true;
  const limit = value.source === 'price' ? PRICE_STALE_DAYS : VALUATION_STALE_DAYS;
  return value.asOf === null || daysBetween(value.asOf, date) > limit;
}
