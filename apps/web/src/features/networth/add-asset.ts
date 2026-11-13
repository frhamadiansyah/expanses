import {
  type AssetKind,
  assetItem,
  type CoretaxSection,
  type OwnableItem,
  parseMajor,
  parseUnits,
  type PlanGroup,
  presetFor,
  type UnitKind,
} from '@expanses/core';
import type { RecordTradeInput } from '@expanses/db';
import { type AcquiredParts, acquiredOn, type DatePrecision, NO_DATE } from './acquired';
import { draftToInput } from './trade-form';
import { withCharged } from './trade-money';

export interface PurchaseDraft {
  /** When it was bought: a year, and a month and day if known. */
  on: AcquiredParts;
  /** Units, shares or grams, as typed. */
  units: string;
  /** What the purchase cost in total, as typed. */
  cost: string;
}

/** A holding's purchase: one made now, paid from an account (New purchase), or ones made before (Past purchase). */
export type PurchaseWhen = 'new' | 'past';

/** New purchase: the one buy, as Trade's Buy asks it — the day, how much, what it cost, a fee, and what paid. */
export interface NewBuyDraft {
  /** YYYY-MM-DD; today unless changed. */
  on: string;
  /** Units, grams or par value, as typed; optional for a fund tracked by money. */
  units: string;
  /** What it cost before fees, in the holding's currency. */
  cost: string;
  fee: string;
  /** The account or card that paid. */
  moneyId: string;
  /** A card purchase: the category it counts under for points, and its merchant code. */
  spendCategoryId: string;
  mcc: string;
  /** What left the paying account in its own currency, when that is not the holding's. */
  charged: string;
}

export const emptyBuy = (today: string): NewBuyDraft => ({ on: today, units: '', cost: '', fee: '', moneyId: '', spendCategoryId: '', mcc: '', charged: '' });

export interface NewAssetDraft {
  /** An id from the catalogue — a named item, or an `else:NNNN` code out of "Something else". */
  itemId: string;
  name: string;
  currency: string;
  /** Holdings: bought now (`buy`) or owned before (`purchases`). Ignored by everything else. */
  when: PurchaseWhen;
  buy: NewBuyDraft;
  /** Holdings: what the owner already has, entered as opening positions. */
  purchases: PurchaseDraft[];
  /** Property, vehicles and other assets: when it was acquired and what it cost. */
  acquired: AcquiredParts;
  cost: string;
  /** Optional first estimate of what it is worth now. Always saved as the owner's estimate. */
  estimate: string;
  /** What one unit of the asset's currency was worth in base when it was got. Held in the ledger only. */
  openingRate: string;
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
    acquiredYear: number | null;
  } | null;
  /**
   * The day it was acquired and how much of that day was typed, for the asset's page to show as typed. Null when
   * nothing says (a holding with no purchases yet, or money owed).
   */
  acquired: { on: string; precision: DatePrecision } | null;
  /** Set instead of `profile` when the thing chosen is money owed: what to open in the ledger. */
  person: { direction: 'lent' | 'borrowed'; personName: string; coretaxCode: string; balanceMinor: number } | null;
  /** Opening positions, paid from Opening Balances so bank balances do not move. */
  trades: { occurredOn: string; unitsMicro: number; grossMinor: number }[];
  /**
   * New purchase: the buy to record with the holding, read by Trade's own rules (`draftToInput`, `withCharged`) — so
   * adding it this way is the same as adding it empty and buying it from Trade. Null for Past purchase and the rest.
   */
  buy: Omit<RecordTradeInput, 'accountId'> | null;
  valuation: { asOf: string; valueMinor: number; basis: 'estimate' } | null;
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

/**
 * A holding tracked by money (a mutual fund, spec 2026-10-19-fund-by-amount): its purchases are amounts, units only if
 * the owner knows them, and what it is worth now is typed from the fund app.
 */
export const byMoneyItem = (itemId: string, typedInstead = false): boolean => {
  const { behaviour } = chosenItem(itemId, typedInstead);
  return behaviour.opens === 'holding' && presetFor(behaviour.assetKind).valuationMode === 'amount';
};

/** Anything the owner puts a value on — property, a car, a patent — is estimated instead. */
export const needsEstimate = (itemId: string, typedInstead = false): boolean => {
  const { behaviour } = chosenItem(itemId, typedInstead);
  return behaviour.opens === 'holding' && behaviour.valuedBy === 'value';
};

/** A purchase row as first drawn: no date picked, nothing bought yet. */
export const emptyPurchase = (): PurchaseDraft => ({ on: NO_DATE, units: '', cost: '' });

export function emptyDraft(itemId: string, currency: string, today: string, typedInstead = false): NewAssetDraft {
  return {
    itemId,
    name: '',
    currency,
    // A holding being added is most often one just bought: New purchase first (owner, 13 Nov 2026).
    when: needsPurchases(itemId, typedInstead) ? 'new' : 'past',
    buy: emptyBuy(today),
    purchases: needsPurchases(itemId, typedInstead) ? [emptyPurchase()] : [],
    acquired: NO_DATE,
    cost: '',
    estimate: '',
    openingRate: '',
    typedInstead,
    personName: '',
  };
}

/** What New purchase needs to know about what paid: its currency, and whether it is a credit card. */
export interface BuyPayment {
  cashCurrency: string;
  isCard: boolean;
}

/** New purchase's buy, by Trade's rules: `draftToInput` for the figures and the card's facts, `withCharged` for another currency. */
function planBuy(draft: NewAssetDraft, today: string, pay: BuyPayment | undefined): Omit<RecordTradeInput, 'accountId'> {
  const { buy } = draft;
  if (!buy.moneyId) throw new Error('Choose what paid for it');
  const byMoney = byMoneyItem(draft.itemId, draft.typedInstead);
  const input = draftToInput(
    {
      kind: 'buy',
      // Not opened yet: the save puts the new holding's id on it.
      accountId: 'new',
      occurredOn: buy.on,
      units: buy.units,
      gross: buy.cost,
      fee: buy.fee,
      tax: '',
      cashAccountId: buy.moneyId,
      goalId: '',
      parts: [],
      spendCategoryId: buy.spendCategoryId,
      mcc: buy.mcc,
    },
    draft.currency,
    today,
    byMoney,
    pay?.isCard ?? false,
  );
  const { accountId: _new, ...rest } = withCharged(input, buy.charged, draft.currency, pay?.cashCurrency ?? draft.currency);
  return rest;
}

/**
 * Turns what the owner typed into the account, profile, opening positions (or the buy made now) and first estimate to
 * write. `pay` is what paid for a new purchase. Throws with a message meant for the screen.
 */
export function planNewAsset(draft: NewAssetDraft, today: string, pay?: BuyPayment): NewAssetPlan {
  const item = chosenItem(draft.itemId, draft.typedInstead);
  const { behaviour } = item;
  const holding = behaviour.opens === 'holding' ? behaviour : null;
  const name = draft.name.trim();
  if (!name) throw new Error('Give this asset a name');

  const trades: NewAssetPlan['trades'] = [];
  let openingBalanceMinor = 0;
  let openedOn = today;
  let acquired: NewAssetPlan['acquired'] = null;
  let buy: NewAssetPlan['buy'] = null;

  if (needsPurchases(draft.itemId, draft.typedInstead) && draft.when === 'new') {
    buy = planBuy(draft, today, pay);
    acquired = { on: buy.occurredOn, precision: 'day' };
  } else if (needsPurchases(draft.itemId, draft.typedInstead)) {
    for (const purchase of draft.purchases) {
      const hasUnits = purchase.units.trim() !== '';
      const hasCost = purchase.cost.trim() !== '';
      if (!hasUnits && !hasCost) continue;
      const bought = acquiredOn(purchase.on, today);
      const byMoney = byMoneyItem(draft.itemId, draft.typedInstead);
      if (byMoney ? !hasCost : !hasUnits || !hasCost) {
        throw new Error(byMoney ? 'Each purchase needs the amount put in' : 'Each purchase needs both how much was bought and what it cost');
      }
      const unitsMicro = hasUnits ? parseUnits(purchase.units) : 0;
      const grossMinor = parseMajor(purchase.cost, draft.currency);
      if (hasUnits && unitsMicro <= 0) throw new Error('A purchase needs more than zero units');
      if (grossMinor <= 0) throw new Error('A purchase needs a cost greater than zero');
      trades.push({ occurredOn: bought.on, unitsMicro, grossMinor });
      // The holding was acquired with its earliest purchase, at the precision that purchase was typed.
      if (!acquired || bought.on < acquired.on) acquired = bought;
    }
  } else if (behaviour.opens === 'person') {
    // Money owed has no date row: it is owed from today, whatever it is.
    if (draft.cost.trim() !== '') openingBalanceMinor = parseMajor(draft.cost, draft.currency);
    if (openingBalanceMinor < 0) throw new Error('A cost cannot be negative');
  } else {
    // The year is always asked, so the tax report has one even before a cost is known.
    acquired = acquiredOn(draft.acquired, today);
    if (draft.cost.trim() !== '') {
      openingBalanceMinor = parseMajor(draft.cost, draft.currency);
      if (openingBalanceMinor < 0) throw new Error('A cost cannot be negative');
      openedOn = acquired.on;
    }
  }

  let valuation: NewAssetPlan['valuation'] = null;
  if ((needsEstimate(draft.itemId, draft.typedInstead) || byMoneyItem(draft.itemId, draft.typedInstead)) && draft.estimate.trim() !== '') {
    valuation = { asOf: today, valueMinor: parseMajor(draft.estimate, draft.currency), basis: 'estimate' };
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
          acquiredYear: acquired ? Number(acquired.on.slice(0, 4)) : null,
        }
      : null,
    acquired: holding ? acquired : null,
    person: behaviour.opens === 'person' ? { direction: behaviour.direction, personName, coretaxCode: item.code, balanceMinor: openingBalanceMinor } : null,
    trades,
    buy,
    valuation,
    rateNeededMinor: trades.length ? trades.reduce((sum, trade) => sum + trade.grossMinor, 0) : openingBalanceMinor,
    rateDate: trades.length ? trades.reduce((earliest, trade) => (trade.occurredOn < earliest ? trade.occurredOn : earliest), trades[0]!.occurredOn) : openedOn,
  };
}
