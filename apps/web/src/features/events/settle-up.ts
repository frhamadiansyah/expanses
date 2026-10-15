import { convertMinor, minorToMajorString, parseMajor } from '@expanses/core';

/** Units of the base currency per one of each side, as `resolveRates` gives them (the base itself is 1). */
export interface SettleRate {
  /** The event currency's. */
  from: number;
  /** The account currency's. */
  to: number;
}

/**
 * What a settle-up moved in an account of another currency (ruling R5), worked out from the amount as it stands **now**
 * — never from the amount at the moment the account was picked. A part payment typed after the pick (₺ 1.000 of a
 * suggested ₺ 2.900) must post the rupiah for ₺ 1.000, or the account is wrong by the difference and the exchange line
 * silently takes it. A figure the person typed by hand is theirs and wins; without one and without a rate, it is said
 * plainly, so the figure can be typed.
 */
export function settleFigure(input: { amountMinor: number; eventCurrency: string; accountCurrency: string; typed: string | null; rate: SettleRate | null }): number {
  if (input.typed !== null) {
    const typed = parseMajor(input.typed, input.accountCurrency);
    if (!Number.isSafeInteger(typed) || typed <= 0) throw new Error(`Enter what moved in ${input.accountCurrency}`);
    return typed;
  }
  if (!input.rate) throw new Error(`No ${input.accountCurrency} rate for today yet: type the figure in ${input.accountCurrency}`);
  return convertMinor(input.amountMinor, input.eventCurrency, input.accountCurrency, input.rate.from / input.rate.to);
}

/** The figure shown in "In IDR" until it is typed over: the amount as it stands, at the rate held, or blank. */
export function suggestedFigure(amount: string, eventCurrency: string, accountCurrency: string, rate: SettleRate | null): string {
  if (!rate) return '';
  try {
    const amountMinor = parseMajor(amount, eventCurrency);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return '';
    return minorToMajorString(settleFigure({ amountMinor, eventCurrency, accountCurrency, typed: null, rate }), accountCurrency);
  } catch {
    return '';
  }
}
