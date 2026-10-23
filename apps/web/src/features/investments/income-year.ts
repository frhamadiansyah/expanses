import { formatMinor, holdingPositionAfter, type TradeRecord } from '@expanses/core';

/** What one holding realized from its sells and earned in dividends and coupons since 1 January. */
export interface HoldingYear {
  realizedMinor: number;
  incomeMinor: number;
}

/** One of the year's two figures: the base currency's sum, and every other currency's own, in words. */
export interface YearSum {
  base: number;
  others: string;
}

/**
 * What each holding realized and earned since 1 January of `today`'s year: its position now, less its position on 31
 * December. A sell's gain is worked out at the average cost of the time, so a buy last year still counts in this one.
 */
export function yearByHolding(holdings: readonly { accountId: string }[], trades: readonly TradeRecord[], today: string): Record<string, HoldingYear> {
  const lastYearEnd = `${Number(today.slice(0, 4)) - 1}-12-31`;
  const out: Record<string, HoldingYear> = {};
  for (const holding of holdings) {
    const list = trades.filter((trade) => trade.accountId === holding.accountId);
    const all = holdingPositionAfter(list);
    const before = holdingPositionAfter(list, lastYearEnd);
    out[holding.accountId] = { realizedMinor: all.realizedMinor - before.realizedMinor, incomeMinor: all.incomeMinor - before.incomeMinor };
  }
  return out;
}

/**
 * The year's figure added up per currency: a holding in dollars is never summed into rupiah unconverted. The base
 * currency's sum is the figure; any other currency with something in it is said under it ("US$12,50 · €3,00").
 */
export function yearSum(
  holdings: readonly { accountId: string; currency: string }[],
  byHolding: Record<string, HoldingYear>,
  pick: keyof HoldingYear,
  baseCurrency: string,
): YearSum {
  const sums = new Map<string, number>();
  for (const holding of holdings) sums.set(holding.currency, (sums.get(holding.currency) ?? 0) + (byHolding[holding.accountId]?.[pick] ?? 0));
  const others = [...sums].filter(([currency, minor]) => currency !== baseCurrency && minor !== 0);
  return { base: sums.get(baseCurrency) ?? 0, others: others.map(([currency, minor]) => formatMinor(minor, currency)).join(' · ') };
}
