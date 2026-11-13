import { type AssetKind, parseMajor, parseUnits, type PaymentOption, unitsFromLots } from '@expanses/core';
import type { AccountRow, AssetProfileRow, AssetValueRow, RecordTradeInput } from '@expanses/db';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders } from '../../lib/queries';
import { withCharged } from '../networth/trade-money';
import { paymentOptions, withoutPlaceholders } from './quick-row';
import { unitWord } from './buy-rows';

export interface BuyChoice {
  /** "buy:<accountId>" or "sell:<accountId>", the value the picker carries. */
  value: string;
  label: string;
  accountId: string;
  mode: 'buy' | 'sell';
  /** 100 for an IDX stock, 1 for a US stock, null when the holding has no lots. */
  lotSize: number | null;
  unitLabel: string;
  /** The holding's kind, which heading the Investment sheet lists it under; null for one with no profile. */
  kind: AssetKind | null;
  /** Where it is held (a bond's or a fund's Held at), when its name does not already say it. */
  heldAt: string | null;
}


/** Holdings measured in units: the only things you can buy or sell from the transaction window. */
export function buyChoices(values: AssetValueRow[], profiles: AssetProfileRow[]): { buys: BuyChoice[]; sells: BuyChoice[] } {
  const holdings = values.filter((value) => value.mode === 'market');
  const choice = (value: AssetValueRow, mode: 'buy' | 'sell'): BuyChoice => {
    const profile = profiles.find((row) => row.accountId === value.accountId);
    const inst = profile?.coretaxFields.inst?.trim() ?? '';
    return {
      value: `${mode}:${value.accountId}`,
      // The holding's own name: the tab already says Buy or Sell, so the list does not say it again.
      label: value.name,
      accountId: value.accountId,
      mode,
      lotSize: profile?.lotSize ?? null,
      unitLabel: unitWord(profile?.unitKind),
      kind: profile?.assetKind ?? null,
      // "RDPU · Bibit" already says where it is: the place is never said twice.
      heldAt: inst && !value.name.toLowerCase().includes(inst.toLowerCase()) ? inst : null,
    };
  };
  return {
    buys: holdings.map((value) => choice(value, 'buy')),
    sells: holdings.filter((value) => (value.unitsMicro ?? 0) > 0).map((value) => choice(value, 'sell')),
  };
}

/** The Investment sheet's headings, in the order they are listed: anything else goes last, under Other. */
const KIND_SECTIONS: readonly { key: string; title: string; kinds: readonly (AssetKind | null)[] }[] = [
  { key: 'bond', title: 'Bonds', kinds: ['bond'] },
  { key: 'fund', title: 'Funds', kinds: ['fund'] },
  { key: 'stock', title: 'Stocks', kinds: ['stock'] },
  { key: 'gold', title: 'Gold', kinds: ['gold'] },
];

export interface InvestmentSection {
  key: string;
  title: string;
  rows: BuyChoice[];
}

/**
 * The Investment sheet's list: the tab's holdings under their kind's heading, each kind in the order the holdings
 * came, and a search that looks at the name and where it is held. A heading with nothing under it is left out.
 */
export function investmentSections(choices: readonly BuyChoice[], typed: string): InvestmentSection[] {
  const wanted = typed.trim().toLowerCase();
  const matches = (choice: BuyChoice) => !wanted || [choice.label, choice.heldAt ?? ''].some((text) => text.toLowerCase().includes(wanted));
  const found = choices.filter(matches);
  const named = new Set(KIND_SECTIONS.flatMap((section) => section.kinds));
  const sections: InvestmentSection[] = KIND_SECTIONS.map((section) => ({
    key: section.key,
    title: section.title,
    rows: found.filter((choice) => section.kinds.includes(choice.kind)),
  }));
  sections.push({ key: 'other', title: 'Other', rows: found.filter((choice) => !named.has(choice.kind)) });
  return sections.filter((section) => section.rows.length > 0);
}

/**
 * What a trade's money can be — Trade's Paid with on a buy, Proceeds into on a sell — the one list Trade and Add
 * asset's New purchase both offer: what can pay (`canPayWith`), cards included, on a buy; money held, never a card,
 * on a sell. An account this device does not list (`listed`, a placeholder of household sharing) is left out unless
 * it is the one the trade already names.
 */
export function tradeMoneyChoices(accounts: readonly AccountRow[], mode: 'buy' | 'sell', current: string, listed?: ReadonlySet<string>): PaymentOption[] {
  const options = paymentOptions(
    moneyHolders(accounts).filter((a) => canPayWith(a, current) && (mode === 'buy' || a.kind === 'asset' || a.id === current)),
    [],
  );
  return listed ? withoutPlaceholders(options, listed, current) : options;
}

export interface PurchaseDraft {
  mode: 'buy' | 'sell';
  accountId: string;
  occurredOn: string;
  /** Typed units or grams; ignored when lots are used. */
  units: string;
  lots: string;
  useLots: boolean;
  lotSize: number | null;
  amount: string;
  fee: string;
  /** Bank, cash, savings — or a credit card on a purchase. */
  moneyId: string;
  moneyIsCard: boolean;
  goalId: string;
  /** Category of a card purchase, so points still count. */
  spendCategoryId: string;
  mcc: string;
  /** What left or reached the paying account in its own currency, when it differs from the holding's. */
  charged: string;
}

export const emptyPurchaseDraft = (accountId: string, moneyId: string, today: string): PurchaseDraft => ({
  mode: 'buy',
  accountId,
  occurredOn: today,
  units: '',
  lots: '',
  useLots: false,
  lotSize: null,
  amount: '',
  fee: '0',
  moneyId,
  moneyIsCard: false,
  goalId: '',
  spendCategoryId: '',
  mcc: '',
  charged: '',
});

/**
 * Turns what was typed into a trade to record, with messages meant for the screen. `cashCurrency` is the paying or
 * receiving account's; when it differs from the holding's, what was charged goes on the input (`withCharged`).
 */
export function purchaseDraftToInput(draft: PurchaseDraft, currency: string, today: string, cashCurrency = currency): RecordTradeInput {
  if (!draft.accountId) throw new Error('Choose what was bought or sold');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A purchase cannot be dated after today');
  if (draft.mode === 'sell' && draft.moneyIsCard) throw new Error('Choose a bank or cash account for the proceeds');

  let unitsMicro: number;
  if (draft.useLots) {
    const lots = Number(draft.lots.trim().replace(',', '.'));
    if (!(lots > 0)) throw new Error('Enter how many lots');
    unitsMicro = unitsFromLots(lots, draft.lotSize ?? 1);
  } else {
    if (draft.units.trim() === '') throw new Error('Enter how many units, shares or grams');
    try {
      unitsMicro = parseUnits(draft.units);
    } catch {
      throw new Error('Units must be a number');
    }
    if (unitsMicro <= 0) throw new Error('Enter more than zero units');
  }

  if (draft.amount.trim() === '') throw new Error(draft.mode === 'buy' ? 'Enter what it cost, before fees' : 'Enter the proceeds, before fees');
  let grossMinor: number;
  try {
    grossMinor = parseMajor(draft.amount, currency);
  } catch {
    throw new Error(draft.mode === 'buy' ? 'What it cost must be a number' : 'The proceeds must be a number');
  }
  if (!(grossMinor > 0)) throw new Error(draft.mode === 'buy' ? 'Enter what it cost, before fees' : 'Enter the proceeds, before fees');

  let feeMinor = 0;
  if (draft.fee.trim() !== '') {
    try {
      feeMinor = parseMajor(draft.fee, currency);
    } catch {
      throw new Error('The fee must be a number');
    }
    if (feeMinor < 0) throw new Error('A fee cannot be negative');
  }

  const input: RecordTradeInput = {
    accountId: draft.accountId,
    kind: draft.mode,
    occurredOn: draft.occurredOn,
    unitsMicro,
    grossMinor,
    feeMinor,
    taxMinor: 0,
    cashAccountId: draft.moneyId || null,
    goalId: draft.goalId || null,
    spendCategoryId: draft.moneyIsCard && draft.spendCategoryId ? draft.spendCategoryId : null,
    mcc: draft.moneyIsCard && draft.mcc.trim() !== '' ? draft.mcc.trim() : null,
  };
  return withCharged(input, draft.charged, currency, cashCurrency);
}

/**
 * Where a transfer may land. Holdings measured in units are left out: moving money into one
 * records no units, so the value would drop out of your net worth.
 *
 * Everything else lands, and the debts are the point of it: paying a card's statement is a transfer *into* the card,
 * paying an instalment is a transfer into the loan, and settling with a person is a transfer into their account. The
 * asymmetry is deliberate — a debt may **receive** money, and can never be where money comes *from*.
 */
export function transferTargets(accounts: AccountRow[], values: AssetValueRow[]): AccountRow[] {
  // A fund tracked by money is a holding too: money reaches it by a buy, never a transfer.
  const unitPriced = new Set(values.filter((value) => value.mode === 'market' || value.mode === 'amount').map((value) => value.accountId));
  return accounts.filter((account) => !unitPriced.has(account.id));
}
