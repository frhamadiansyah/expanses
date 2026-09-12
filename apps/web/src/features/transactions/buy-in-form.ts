import { parseMajor, parseUnits, unitsFromLots } from '@expanses/core';
import type { AccountRow, AssetProfileRow, AssetValueRow, RecordTradeInput } from '@expanses/db';

export interface BuyChoice {
  /** "buy:<accountId>" or "sell:<accountId>", the value the picker carries. */
  value: string;
  label: string;
  accountId: string;
  mode: 'buy' | 'sell';
  /** 100 for an IDX stock, 1 for a US stock, null when the holding has no lots. */
  lotSize: number | null;
  unitLabel: string;
}

const UNIT_LABELS: Record<string, string> = { units: 'Units', shares: 'Shares', grams: 'Grams', face: 'Units' };

/** Holdings measured in units: the only things you can buy or sell from the transaction window. */
export function buyChoices(values: AssetValueRow[], profiles: AssetProfileRow[]): { buys: BuyChoice[]; sells: BuyChoice[] } {
  const holdings = values.filter((value) => value.mode === 'market');
  const choice = (value: AssetValueRow, mode: 'buy' | 'sell'): BuyChoice => {
    const profile = profiles.find((row) => row.accountId === value.accountId);
    return {
      value: `${mode}:${value.accountId}`,
      label: `${mode === 'buy' ? 'Investments' : 'Sell'} › ${value.name}`,
      accountId: value.accountId,
      mode,
      lotSize: profile?.lotSize ?? null,
      unitLabel: UNIT_LABELS[profile?.unitKind ?? 'units'] ?? 'Units',
    };
  };
  return {
    buys: holdings.map((value) => choice(value, 'buy')),
    sells: holdings.filter((value) => (value.unitsMicro ?? 0) > 0).map((value) => choice(value, 'sell')),
  };
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
});

/** Turns what was typed into a trade to record, with messages meant for the screen. */
export function purchaseDraftToInput(draft: PurchaseDraft, currency: string, today: string): RecordTradeInput {
  if (!draft.accountId) throw new Error('Choose what you bought or sold');
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

  return {
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
}

/**
 * Where a transfer may land. Holdings measured in units are left out: moving money into one
 * records no units, so the value would drop out of your net worth.
 */
export function transferTargets(accounts: AccountRow[], values: AssetValueRow[]): AccountRow[] {
  const unitPriced = new Set(values.filter((value) => value.mode === 'market').map((value) => value.accountId));
  return accounts.filter((account) => !unitPriced.has(account.id));
}
