import type { AssetKind, PlanGroup, UnitKind, ValuationMode } from '@expanses/core';

export const PLAN_GROUP_LABELS: Record<PlanGroup, string> = {
  liquid: 'Cash & equivalents',
  invest: 'Investments',
  owed: 'Owed to you',
  use: 'Personal use',
};

/** Order the balance sheet reads in, most liquid first. */
export const PLAN_GROUP_ORDER: PlanGroup[] = ['liquid', 'invest', 'owed', 'use'];

export const METHOD_LABELS: Record<ValuationMode, string> = {
  derived: 'Ledger balance',
  market: 'Units × price',
  snapshot: 'Your estimate',
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
  estimate: 'My estimate',
  appraisal: 'Appraisal',
  listing: 'Nearby listings',
  njop: 'NJOP from the PBB notice',
  purchase: 'What I paid',
};
