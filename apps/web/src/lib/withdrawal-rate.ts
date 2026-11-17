import { currencyInfo, formatMinor } from '@expanses/core';
import type { ForeignLotsView } from '@expanses/db';
import { shortDate } from '../features/transactions/quick-row';

/*
 * The withdrawal rate's words (spec §7), worked out away from the screens that show them so every figure can be tested
 * without a browser. Copy never says "you" or "your".
 */

type Rates = Readonly<Record<string, number>>;

const number = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/** "₺ 300", "₺ 12,50": the currency's own symbol, cents only when there are some. */
export function foreignMoney(minor: number, currency: string): string {
  const { exponent, symbol } = currencyInfo(currency);
  const whole = minor % 10 ** exponent === 0;
  const digits = whole ? 0 : exponent;
  return `${symbol} ${(minor / 10 ** exponent).toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "Rp 525": base units per one foreign unit, with the base currency's symbol. */
const unitPrice = (costBaseMinor: number, minor: number, currency: string, baseCurrency: string) =>
  `${currencyInfo(baseCurrency).symbol} ${number(costBaseMinor / 10 ** currencyInfo(baseCurrency).exponent / (minor / 10 ** currencyInfo(currency).exponent))}`;

/**
 * The Add screen's line (§7): "≈ Rp 236.250 at the withdrawal rate (525)"; with money no withdrawal covers,
 * "≈ Rp 238.900 · ₺ 300 at today’s rate (no withdrawal recorded)"; with no rate for today, only the shortfall.
 */
export function withdrawalRateLine(cost: { costBaseMinor: number | null; uncoveredMinor: number; ratePerUnit: number | null }, currency: string, baseCurrency: string): string | null {
  return costLine(cost, currency, baseCurrency, 'today’s rate');
}

/**
 * The receipt's line (§7, final review M2): the same, except that a saved spend's uncovered part was valued at the
 * rate of the day it was spent (R4), which on a receipt from months ago is not today's: "· ₺ 300 at the day’s rate".
 */
export function receiptWithdrawalLine(cost: { costBaseMinor: number | null; uncoveredMinor: number; ratePerUnit: number | null }, currency: string, baseCurrency: string): string | null {
  return costLine(cost, currency, baseCurrency, 'the day’s rate');
}

function costLine(cost: { costBaseMinor: number | null; uncoveredMinor: number; ratePerUnit: number | null }, currency: string, baseCurrency: string, rate: string): string | null {
  if (cost.uncoveredMinor === 0) {
    if (cost.costBaseMinor === null || cost.ratePerUnit === null) return null;
    return `≈ ${formatMinor(cost.costBaseMinor, baseCurrency)} at the withdrawal rate (${number(cost.ratePerUnit)})`;
  }
  const uncovered = foreignMoney(cost.uncoveredMinor, currency);
  if (cost.costBaseMinor === null) return `${uncovered} has no withdrawal recorded and no rate for today yet`;
  return `≈ ${formatMinor(cost.costBaseMinor, baseCurrency)} · ${uncovered} at ${rate} (no withdrawal recorded)`;
}

/**
 * A saved transfer between currencies, on its receipt (owner, 17 Nov 2026): the Rate row — "Rp 20.700 per GBP", the
 * foreign currency priced in the base — and under it how far that was from the market rate held for the day: "market
 * 21.000 · −1,4 %", or nothing when none is held. Null when neither side is the base currency, or both are one currency.
 * It says what the bank gave, never that the difference counts anywhere: an exchange's gain or loss counts nowhere.
 */
export function transferRateParts(input: {
  fromMinor: number;
  fromCurrency: string;
  toMinor: number;
  toCurrency: string;
  baseCurrency: string;
  ratesToBase: Rates;
}): { rate: string; market: string | null } | null {
  const { fromMinor, fromCurrency, toMinor, toCurrency, baseCurrency, ratesToBase } = input;
  if (!(fromMinor > 0) || !(toMinor > 0) || fromCurrency === toCurrency) return null;
  const fromBase = fromCurrency === baseCurrency;
  if (!fromBase && toCurrency !== baseCurrency) return null;
  const foreign = fromBase ? toCurrency : fromCurrency;
  const baseMinor = fromBase ? fromMinor : toMinor;
  const foreignMinor = fromBase ? toMinor : fromMinor;
  const price = baseMinor / 10 ** currencyInfo(baseCurrency).exponent / (foreignMinor / 10 ** currencyInfo(foreign).exponent);
  const rate = `${currencyInfo(baseCurrency).symbol} ${number(price)} per ${foreign}`;
  const market = ratesToBase[foreign];
  if (market === undefined || !(market > 0)) return { rate, market: null };
  const percent = (price / market - 1) * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '±';
  return { rate, market: `market ${number(market)} · ${sign}${Math.abs(percent).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` };
}

/** The receipt's "From the 12 Nov withdrawal" or "From 2 withdrawals" (§7). */
export function fromWithdrawalsText(uses: readonly { lotId: string; lotDate: string }[], today: string): string | null {
  const lots = new Map(uses.map((use) => [use.lotId, use.lotDate]));
  if (lots.size === 0) return null;
  if (lots.size > 1) return `From ${lots.size} withdrawals`;
  return `From the ${shortDate([...lots.values()][0]!, today)} withdrawal`;
}

export interface WithdrawalsLeftView {
  costText: string;
  rows: { key: string; title: string; value: string }[];
  shortfallText: string | null;
}

/** The foreign account page's Cost and "Withdrawals left" (§7): each open lot as "₺ 9.550 of ₺ 10.000 · Rp 525". */
export function withdrawalsLeftView(lots: ForeignLotsView, baseCurrency: string, today: string): WithdrawalsLeftView {
  return {
    costText: formatMinor(lots.costBaseMinor, baseCurrency),
    rows: lots.open.map((lot, i) => ({
      key: `${lot.lotId}-${i}`,
      title: shortDate(lot.lotDate, today),
      value: `${foreignMoney(lot.leftMinor, lots.currency)} of ${foreignMoney(lot.minor, lots.currency)} · ${unitPrice(lot.costBaseMinor, lot.minor, lots.currency, baseCurrency)}`,
    })),
    shortfallText: lots.shortfallMinor > 0 ? `${foreignMoney(lots.shortfallMinor, lots.currency)} spent with no withdrawal recorded, valued at the day’s rate` : null,
  };
}

/** The first run's one notice (§6, R18). */
export const WITHDRAWAL_RATE_NOTICE = 'Foreign-currency spending now uses the withdrawal rate. Past months may change slightly.';
