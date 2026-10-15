import { convertMinor, currencyInfo, formatMinor } from '@expanses/core';
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
 * A cross-currency transfer's Rate row (§7, R15): "Rp 525 per TRY (market 512, +2,5 %)" — the foreign currency priced
 * in the base, against the day's rate held for it. Null when neither side is the base currency: that pair keeps its
 * plain "1 USD = 1,2760 SGD".
 */
export function transferRateText(input: { fromMinor: number; fromCurrency: string; toMinor: number; toCurrency: string; baseCurrency: string; ratesToBase: Rates }): string | null {
  const { fromMinor, fromCurrency, toMinor, toCurrency, baseCurrency, ratesToBase } = input;
  if (!(fromMinor > 0) || !(toMinor > 0) || fromCurrency === toCurrency) return null;
  const fromBase = fromCurrency === baseCurrency;
  if (!fromBase && toCurrency !== baseCurrency) return null;
  const foreign = fromBase ? toCurrency : fromCurrency;
  const baseMinor = fromBase ? fromMinor : toMinor;
  const foreignMinor = fromBase ? toMinor : fromMinor;
  const price = baseMinor / 10 ** currencyInfo(baseCurrency).exponent / (foreignMinor / 10 ** currencyInfo(foreign).exponent);
  const head = `${currencyInfo(baseCurrency).symbol} ${number(price)} per ${foreign}`;
  const market = ratesToBase[foreign];
  if (market === undefined || !(market > 0)) return head;
  const percent = (price / market - 1) * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : '±';
  return `${head} (market ${number(market)}, ${sign}${Math.abs(percent).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %)`;
}

/**
 * An exchange out of a foreign account before it is saved (§5, §7): what arrived, at its own value — its amount in the
 * base currency, else the day's rate held for it (R6) — less what the foreign money cost. Null without a cost or a rate.
 */
export function exchangeOutPreview(input: { costBaseMinor: number | null; receivedMinor: number; receivedCurrency: string; baseCurrency: string; ratesToBase: Rates }): { receivedBaseMinor: number; gainLossBaseMinor: number } | null {
  if (input.costBaseMinor === null) return null;
  let receivedBaseMinor = input.receivedMinor;
  if (input.receivedCurrency !== input.baseCurrency) {
    const rate = input.ratesToBase[input.receivedCurrency];
    if (rate === undefined || !(rate > 0)) return null;
    receivedBaseMinor = convertMinor(input.receivedMinor, input.receivedCurrency, input.baseCurrency, rate);
  }
  return { receivedBaseMinor, gainLossBaseMinor: receivedBaseMinor - input.costBaseMinor };
}

export interface ExchangeResultLine {
  title: string;
  figure: string;
  note: string;
}

/** "Exchange loss Rp 10.000 (recorded as spending)" in its three parts (§7). */
export function exchangeResultLine(gainLossBaseMinor: number, baseCurrency: string): ExchangeResultLine {
  if (gainLossBaseMinor < 0) return { title: 'Exchange loss', figure: formatMinor(-gainLossBaseMinor, baseCurrency), note: 'recorded as spending' };
  if (gainLossBaseMinor > 0) return { title: 'Exchange gain', figure: formatMinor(gainLossBaseMinor, baseCurrency), note: 'recorded as income' };
  return { title: 'No exchange gain or loss', figure: formatMinor(0, baseCurrency), note: 'nothing recorded' };
}

export const exchangeResultText = (line: ExchangeResultLine) => `${line.title} ${line.figure} (${line.note})`;

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
