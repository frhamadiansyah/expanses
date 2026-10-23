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

/**
 * Received this year, as Income shows it: the history's estimate and what was recorded, reconciled per payer.
 *
 * For each payer the history estimates for (a listed share across every broker holding it, a bond with coupon terms)
 * the figure is the larger of its estimate and the payments recorded on its holdings: the estimate is before tax and a
 * recorded payment is after it, so a payment both know would otherwise lower the figure the moment it was written
 * down, and a payment only the record knows — Yahoo missing one, a coupon recorded before its day — is not lost. A
 * holding the estimate knows nothing of, a fund named by hand or a share with no ticker, counts what was recorded,
 * which is all there is for it. Every figure arrives in base; a holding whose currency has no rate is left out upstream.
 */
export function receivedThisYear(
  estimated: readonly { accountIds: readonly string[]; minor: number }[],
  recorded: Readonly<Record<string, number>>,
): number {
  const covered = new Set<string>();
  let total = 0;
  for (const payer of estimated) {
    let own = 0;
    for (const accountId of payer.accountIds) {
      covered.add(accountId);
      own += recorded[accountId] ?? 0;
    }
    total += Math.max(payer.minor, own);
  }
  for (const [accountId, minor] of Object.entries(recorded)) if (!covered.has(accountId)) total += minor;
  return total;
}
