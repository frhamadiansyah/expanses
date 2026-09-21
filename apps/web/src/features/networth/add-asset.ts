import {
  type AssetKind,
  assetItem,
  type CoretaxSection,
  type OwnableItem,
  parseMajor,
  parseUnits,
  type PlanGroup,
  type UnitKind,
  type ValuationBasis,
} from '@expanses/core';

export interface PurchaseDraft {
  occurredOn: string;
  /** Units, shares or grams, as typed. */
  units: string;
  /** What the purchase cost in total, as typed. */
  cost: string;
}

export interface NewAssetDraft {
  /** An id from the catalogue — a named item, or an `else:NNNN` code out of "Something else". */
  itemId: string;
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
  /** What one unit of the asset's currency was worth in base when it was got. Held in the ledger only. */
  openingRate: string;
  coretaxFields: Record<string, string>;
  /** Gold jewellery: record what it is worth rather than weigh it. Ignored by everything else. */
  typedInstead: boolean;
  /** A receivable: who owes the money. Empty means "whatever this is called". */
  personName: string;
}

export interface NewAssetPlan {
  account: { name: string; kind: 'asset'; subtype: string; currency: string; openingBalanceMinor: number; openedOn: string };
  /**
   * The asset profile to write, or null when the thing chosen is not a holding at all — a receivable is
   * kept by the Lend & borrow ledger, which has its own profile table.
   */
  profile: {
    assetKind: AssetKind;
    planGroup: PlanGroup;
    unitKind: UnitKind | null;
    lotSize: number | null;
    coretaxSection: CoretaxSection;
    coretaxCode: string;
    coretaxFields: Record<string, string>;
    acquiredYear: number | null;
  } | null;
  /** Set instead of `profile` when the thing chosen is money owed: what to open in the ledger. */
  person: { direction: 'lent' | 'borrowed'; personName: string; coretaxCode: string; balanceMinor: number } | null;
  /** Opening positions, paid from Opening Balances so bank balances do not move. */
  trades: { occurredOn: string; unitsMicro: number; grossMinor: number }[];
  valuation: { asOf: string; valueMinor: number; basis: ValuationBasis } | null;
  /**
   * What will post in the asset's own currency and so needs a rate to base: the purchases' total cost when there
   * are purchases, else the opening balance; 0 when nothing posts. The rate itself is not read here — the form
   * hands `draft.openingRate` to `openingRateFor`, the one reader every form that opens money uses. (This is not
   * the tax report's rate: that one is the KMK figure, entered per year.)
   */
  rateNeededMinor: number;
  /** The day that rate is for: the earliest purchase, else the day the balance opens. */
  rateDate: string;
}

/**
 * The catalogue item behind a draft, with gold jewellery's "I'd rather type what it is worth" already
 * applied: the same code and the same table, recorded as a thing with a value rather than a weight
 * priced per gram. Everything downstream reads the item, so the swap only has to happen here.
 */
export function chosenItem(itemId: string, typedInstead = false): OwnableItem {
  const item = assetItem(itemId);
  const { behaviour } = item;
  if (behaviour.opens === 'holding' && behaviour.orTyped && typedInstead) {
    return { ...item, behaviour: { ...behaviour, assetKind: 'other', unitKind: null, valuedBy: 'value' } };
  }
  return item;
}

/** Anything counted out in units, shares, grams or face value is entered as past purchases. */
export const needsPurchases = (itemId: string, typedInstead = false): boolean => {
  const { behaviour } = chosenItem(itemId, typedInstead);
  return behaviour.opens === 'holding' && (behaviour.valuedBy === 'units' || behaviour.valuedBy === 'face' || behaviour.valuedBy === 'grams');
};

/** Anything the owner puts a value on — property, a car, a patent — is estimated instead. */
export const needsEstimate = (itemId: string, typedInstead = false): boolean => {
  const { behaviour } = chosenItem(itemId, typedInstead);
  return behaviour.opens === 'holding' && behaviour.valuedBy === 'value';
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDraft(itemId: string, currency: string, today: string, typedInstead = false): NewAssetDraft {
  return {
    itemId,
    name: '',
    currency,
    purchases: needsPurchases(itemId, typedInstead) ? [{ occurredOn: today, units: '', cost: '' }] : [],
    purchasedOn: today,
    cost: '',
    estimate: '',
    estimateBasis: 'estimate',
    openingRate: '',
    coretaxFields: {},
    typedInstead,
    personName: '',
  };
}

/**
 * Turns what the owner typed into the account, profile, opening positions and first estimate to write.
 * Throws with a message meant for the screen.
 */
export function planNewAsset(draft: NewAssetDraft, today: string): NewAssetPlan {
  const item = chosenItem(draft.itemId, draft.typedInstead);
  const { behaviour } = item;
  const holding = behaviour.opens === 'holding' ? behaviour : null;
  const name = draft.name.trim();
  if (!name) throw new Error('Give this asset a name');

  const trades: NewAssetPlan['trades'] = [];
  let openingBalanceMinor = 0;
  let openedOn = today;
  let years: number[] = [];

  if (needsPurchases(draft.itemId, draft.typedInstead)) {
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
  if (needsEstimate(draft.itemId, draft.typedInstead) && draft.estimate.trim() !== '') {
    valuation = { asOf: today, valueMinor: parseMajor(draft.estimate, draft.currency), basis: draft.estimateBasis };
    if (valuation.valueMinor < 0) throw new Error('An estimate cannot be negative');
  }

  // The ledger names the account after the person, so "Who" left empty simply means what this is called.
  const personName = draft.personName.trim() || name;

  return {
    account: { name, kind: 'asset', subtype: holding ? holding.subtype : 'receivable', currency: draft.currency, openingBalanceMinor, openedOn },
    profile: holding
      ? {
          assetKind: holding.assetKind,
          planGroup: holding.planGroup,
          unitKind: holding.unitKind,
          lotSize: holding.lotSize,
          // Every asset item files under a table; only a debt's section is null, and no debt reaches here.
          coretaxSection: item.section ?? 'lainnya',
          coretaxCode: item.code,
          coretaxFields: Object.fromEntries(Object.entries(draft.coretaxFields).filter(([, value]) => value.trim() !== '')),
          acquiredYear: years.length ? Math.min(...years) : null,
        }
      : null,
    person: behaviour.opens === 'person' ? { direction: behaviour.direction, personName, coretaxCode: item.code, balanceMinor: openingBalanceMinor } : null,
    trades,
    valuation,
    rateNeededMinor: trades.length ? trades.reduce((sum, trade) => sum + trade.grossMinor, 0) : openingBalanceMinor,
    rateDate: trades.length ? trades.reduce((earliest, trade) => (trade.occurredOn < earliest ? trade.occurredOn : earliest), trades[0]!.occurredOn) : openedOn,
  };
}
