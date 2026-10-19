import type { AssetKind, PlanGroup, UnitKind, ValuationMode } from '@expanses/core';

export const PLAN_GROUP_LABELS: Record<PlanGroup, string> = {
  liquid: 'Cash & equivalents',
  invest: 'Investments',
  owed: 'Receivables',
  use: 'Personal use',
};

/** Order the balance sheet reads in, most liquid first. */
export const PLAN_GROUP_ORDER: PlanGroup[] = ['liquid', 'invest', 'owed', 'use'];

export const METHOD_LABELS: Record<ValuationMode, string> = {
  derived: 'Ledger balance',
  market: 'Units × price',
  snapshot: 'Estimate',
  amount: 'Value typed, moved by buys and sells',
};

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  fund: 'Fund',
  stock: 'Stock',
  bond: 'Bond',
  gold: 'Gold',
  property: 'Property',
  vehicle: 'Vehicle',
  other: 'Other asset',
  cash: 'Bank, cash or deposit',
};

export const UNIT_LABELS: Record<UnitKind, string> = {
  units: 'units',
  shares: 'shares',
  grams: 'g',
  face: 'units',
};

export const CORETAX_SECTION_LABELS: Record<string, string> = {
  kas: 'Kas dan Setara Kas',
  piutang: 'Piutang',
  investasi: 'Investasi/Sekuritas',
  bergerak: 'Harta Bergerak',
  tidak_bergerak: 'Harta Tidak Bergerak',
  lainnya: 'Harta Lainnya',
};

export const BASIS_LABELS: Record<string, string> = {
  estimate: 'Estimated value',
  // No longer asked: every typed value is an estimate. Kept so a value recorded with one still reads as one.
  appraisal: 'Estimated value',
  listing: 'Estimated value',
  // Still left out of the value (core's assetValue), so it says what it was rather than pass for an estimate.
  njop: 'Property tax assessment',
  purchase: 'What I paid',
};
