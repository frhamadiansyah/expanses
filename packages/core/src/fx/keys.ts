import { CASH_ITEMS } from '../assets/catalogue';

/*
 * Withdrawal rate (spec 2026-10-15). Which accounts hold foreign money in lots, and the two categories a realised
 * exchange gain or loss is filed under. Both categories are built-in keys made on first use in the Personal book
 * (ruling R8), so a workspace that never holds foreign money never shows them.
 */

export const EXCHANGE_GAIN_KEY = 'income.exchange_gain';
export const EXCHANGE_LOSS_KEY = 'expense.exchange_loss';
export const EXCHANGE_GAIN_NAME = 'Exchange gain';
export const EXCHANGE_LOSS_NAME = 'Exchange loss';

/** The money kinds (cash, current, saving, deposit, wallet, broker cash, other cash): every one can hold foreign money. */
export const FX_LOT_SUBTYPES: readonly string[] = CASH_ITEMS.map((item) => item.id);

/**
 * Whether an account holds foreign money in lots (D1, ruling R2): one of the owner's own money accounts in a currency
 * other than the base. A card or a loan in another currency keeps the day's rate on its own side (§9), and a receivable,
 * a trip balance or a holding is something money is spent on, not where it waits. A household placeholder has the
 * shape of a money account; the database leaves it out, since only it knows which accounts are placeholders.
 */
export function isFxLotAccount(account: { kind: string; subtype: string; currency: string | null }, baseCurrency: string): boolean {
  return account.kind === 'asset' && FX_LOT_SUBTYPES.includes(account.subtype) && account.currency !== null && account.currency !== baseCurrency;
}

/** Whether a category is one of the two an exchange's gain or loss is filed under. */
export const isExchangeResultKey = (key: string | null | undefined): boolean => key === EXCHANGE_GAIN_KEY || key === EXCHANGE_LOSS_KEY;
