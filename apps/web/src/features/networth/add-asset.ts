import { type AssetKind, type CoretaxSection, parseMajor, parseUnits, presetFor, type ValuationBasis } from '@expanses/core';

export interface PurchaseDraft {
  occurredOn: string;
  /** Units, shares or grams, as typed. */
  units: string;
  /** What the purchase cost in total, as typed. */
  cost: string;
}

export interface NewAssetDraft {
  kind: AssetKind;
  name: string;
  currency: string;
  /** Holdings: what the owner already has, entered as opening positions. */
  purchases: PurchaseDraft[];
  /** Property, vehicles and other assets: when it was bought and what it cost. */
  purchasedOn: string;
  cost: string;
  /** Optional first estimate of what it is worth now. */
  estimate: string;
  estimateBasis: ValuationBasis;
  coretaxFields: Record<string, string>;
}

export interface NewAssetPlan {
  account: { name: string; kind: 'asset'; subtype: string; currency: string; openingBalanceMinor: number; openedOn: string };
  profile: { assetKind: AssetKind; coretaxSection: CoretaxSection; coretaxCode: string; coretaxFields: Record<string, string>; acquiredYear: number | null };
  /** Opening positions, paid from Opening Balances so bank balances do not move. */
  trades: { occurredOn: string; unitsMicro: number; grossMinor: number }[];
  valuation: { asOf: string; valueMinor: number; basis: ValuationBasis } | null;
}

/** Holdings are counted in units and priced; property and vehicles are estimated. */
export const needsPurchases = (kind: AssetKind): boolean => presetFor(kind).valuationMode === 'market';
export const needsEstimate = (kind: AssetKind): boolean => presetFor(kind).valuationMode === 'snapshot';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDraft(kind: AssetKind, currency: string, today: string): NewAssetDraft {
  return {
    kind,
    name: '',
    currency,
    purchases: needsPurchases(kind) ? [{ occurredOn: today, units: '', cost: '' }] : [],
    purchasedOn: today,
    cost: '',
    estimate: '',
    estimateBasis: 'estimate',
    coretaxFields: {},
  };
}

/**
 * Turns what the owner typed into the account, profile, opening positions and first estimate to write.
 * Throws with a message meant for the screen.
 */
export function planNewAsset(draft: NewAssetDraft, today: string): NewAssetPlan {
  const preset = presetFor(draft.kind);
  const name = draft.name.trim();
  if (!name) throw new Error('Give this asset a name');

  const trades: NewAssetPlan['trades'] = [];
  let openingBalanceMinor = 0;
  let openedOn = today;
  let years: number[] = [];

  if (needsPurchases(draft.kind)) {
    for (const purchase of draft.purchases) {
      const hasUnits = purchase.units.trim() !== '';
      const hasCost = purchase.cost.trim() !== '';
      if (!hasUnits && !hasCost) continue;
      if (!DATE.test(purchase.occurredOn)) throw new Error('Each purchase needs a date');
      if (purchase.occurredOn > today) throw new Error('A purchase cannot be dated after today');
      if (!hasUnits || !hasCost) throw new Error('Each purchase needs both how much you bought and what it cost');
      const unitsMicro = parseUnits(purchase.units);
      const grossMinor = parseMajor(purchase.cost, draft.currency);
      if (unitsMicro <= 0) throw new Error('A purchase needs more than zero units');
      if (grossMinor <= 0) throw new Error('A purchase needs a cost greater than zero');
      trades.push({ occurredOn: purchase.occurredOn, unitsMicro, grossMinor });
    }
    years = trades.map((trade) => Number(trade.occurredOn.slice(0, 4)));
  } else if (draft.cost.trim() !== '') {
    if (!DATE.test(draft.purchasedOn)) throw new Error('Say when you bought it');
    if (draft.purchasedOn > today) throw new Error('A purchase cannot be dated after today');
    openingBalanceMinor = parseMajor(draft.cost, draft.currency);
    if (openingBalanceMinor < 0) throw new Error('A cost cannot be negative');
    openedOn = draft.purchasedOn;
    years = [Number(draft.purchasedOn.slice(0, 4))];
  }

  let valuation: NewAssetPlan['valuation'] = null;
  if (needsEstimate(draft.kind) && draft.estimate.trim() !== '') {
    valuation = { asOf: today, valueMinor: parseMajor(draft.estimate, draft.currency), basis: draft.estimateBasis };
    if (valuation.valueMinor < 0) throw new Error('An estimate cannot be negative');
  }

  return {
    account: { name, kind: 'asset', subtype: preset.subtype, currency: draft.currency, openingBalanceMinor, openedOn },
    profile: {
      assetKind: draft.kind,
      coretaxSection: preset.coretaxSection,
      coretaxCode: preset.coretaxCode,
      coretaxFields: Object.fromEntries(Object.entries(draft.coretaxFields).filter(([, value]) => value.trim() !== '')),
      acquiredYear: years.length ? Math.min(...years) : null,
    },
    trades,
    valuation,
  };
}
