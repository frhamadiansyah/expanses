import type { CoretaxSection } from './coretax-fields';
import type { ValuationMode } from './value';

export type AssetKind = 'fund' | 'stock' | 'bond' | 'gold' | 'property' | 'vehicle' | 'other' | 'cash';
/** Where the asset sits on the balance sheet, following the CFP statement of financial position. */
export type PlanGroup = 'liquid' | 'invest' | 'owed' | 'use';
export type UnitKind = 'units' | 'shares' | 'grams' | 'face';
export type Risk = 'low' | 'medium' | 'high';
export type AssetSubtype = 'investment' | 'property' | 'vehicle' | 'bank' | 'cash' | 'savings';

export interface AssetPreset {
  kind: AssetKind;
  label: string;
  subtype: AssetSubtype;
  valuationMode: ValuationMode;
  unitKind: UnitKind | null;
  lotSize: number | null;
  risk: Risk | null;
  planGroup: PlanGroup;
  coretaxSection: CoretaxSection;
  coretaxCode: string;
  priceLabel: string | null;
}

export const ASSET_PRESETS: readonly AssetPreset[] = [
  { kind: 'fund', label: 'Fund', subtype: 'investment', valuationMode: 'market', unitKind: 'units', lotSize: null, risk: 'high', planGroup: 'invest', coretaxSection: 'investasi', coretaxCode: '0307', priceLabel: 'NAV per unit' },
  { kind: 'stock', label: 'Stock', subtype: 'investment', valuationMode: 'market', unitKind: 'shares', lotSize: 100, risk: 'high', planGroup: 'invest', coretaxSection: 'investasi', coretaxCode: '0303', priceLabel: 'Closing price' },
  { kind: 'bond', label: 'Bond', subtype: 'investment', valuationMode: 'market', unitKind: 'face', lotSize: null, risk: 'low', planGroup: 'invest', coretaxSection: 'investasi', coretaxCode: '0305', priceLabel: 'Face value' },
  { kind: 'gold', label: 'Gold', subtype: 'investment', valuationMode: 'market', unitKind: 'grams', lotSize: null, risk: 'medium', planGroup: 'invest', coretaxSection: 'lainnya', coretaxCode: '0701', priceLabel: 'Buyback price per gram' },
  { kind: 'property', label: 'Property', subtype: 'property', valuationMode: 'snapshot', unitKind: null, lotSize: null, risk: null, planGroup: 'use', coretaxSection: 'tidak_bergerak', coretaxCode: '0502', priceLabel: null },
  { kind: 'vehicle', label: 'Vehicle', subtype: 'vehicle', valuationMode: 'snapshot', unitKind: null, lotSize: null, risk: null, planGroup: 'use', coretaxSection: 'bergerak', coretaxCode: '0403', priceLabel: null },
  { kind: 'other', label: 'Other asset', subtype: 'investment', valuationMode: 'snapshot', unitKind: null, lotSize: null, risk: null, planGroup: 'use', coretaxSection: 'lainnya', coretaxCode: '0799', priceLabel: null },
  { kind: 'cash', label: 'Bank, cash or deposit', subtype: 'bank', valuationMode: 'derived', unitKind: null, lotSize: null, risk: null, planGroup: 'liquid', coretaxSection: 'kas', coretaxCode: '0102', priceLabel: null },
];

export function presetFor(kind: AssetKind): AssetPreset {
  const preset = ASSET_PRESETS.find((p) => p.kind === kind);
  if (!preset) throw new Error(`Unknown asset kind "${kind}"`);
  return preset;
}
