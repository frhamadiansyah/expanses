import { couponDatesBetween, type DividendHolding, dividendView, type DividendView, holdingPositionAfter, isoDate, sumToBase, yahooSymbol } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { useMemo } from 'react';
import { useApp } from '../../app/context';
import { useAssetValues, useBondCoupons, useTrades } from '../networth/queries';
import { useDividendHistory } from '../prices/yahoo';
import { receivedThisYear } from './income-year';
import { useTradeBook } from './IncomeTrades';
import { usePortfolio } from './queries';

const DAY = 86_400_000;
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * What the shares and bonds held pay, as Income reads it: the dividend view (a year at today's holdings, the months,
 * who pays) and Received this year — the history's estimate reconciled with what was recorded. One hook, so Income and
 * the Mac Net worth page's Investments box say the same figure.
 */
export function useIncomeYear() {
  const { ws } = useApp();
  const base = ws.baseCurrency;
  const today = isoDate();
  const { view: portfolio, rates, securities, isPending, error } = usePortfolio();
  const trades = useTrades();
  const book = useTradeBook();

  // Only stocks Yahoo knows: a fund or a share named by hand has no ticker there.
  const listed = useMemo(() => {
    const byId = new Map(securities.map((s) => [s.id, s]));
    return (portfolio?.stocks ?? []).flatMap((row) => {
      const security = row.securityId ? byId.get(row.securityId) : undefined;
      return security && yahooSymbol(security) ? [{ row, security }] : [];
    });
  }, [portfolio, securities]);
  const history = useDividendHistory(listed.map((l) => l.security));
  // Bonds with coupon terms pay too: their schedule, from the terms on their Settings, on the par held each day.
  const couponTerms = useBondCoupons();
  const values = useAssetValues();
  const bonds = useMemo(
    () =>
      Object.values(couponTerms.data ?? {}).flatMap((term) => {
        const value = (values.data ?? []).find((row) => row.accountId === term.accountId);
        return value ? [{ term, value }] : [];
      }),
    [couponTerms.data, values.data],
  );
  const bondIds = useMemo(() => new Set(bonds.map((b) => b.term.accountId)), [bonds]);

  const view = useMemo((): DividendView | null => {
    if (!portfolio || !trades.data || !history.data) return null;
    const byAccount = new Map<string, TradeRow[]>();
    for (const trade of trades.data) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
    const holdings: DividendHolding[] = listed.map(({ row, security }) => ({
      securityId: security.id,
      title: row.title,
      currency: row.currency,
      unitsMicro: row.unitsMicro,
      unitsOn: (date) => row.holdings.reduce((sum, h) => sum + holdingPositionAfter(byAccount.get(h.accountId) ?? [], date).unitsMicro, 0),
      costBaseMinor: row.costBaseMinor,
      valueBaseMinor: row.valueBaseMinor,
      payments: history.data[security.id] ?? null,
    }));
    for (const { term, value } of bonds) {
      // A coupon per unit of par: the rate a year over the payments a year. Two years back and the year ahead cover
      // every reading the page makes — the last 12 months, this year and last.
      const perUnit = term.rateBps / 10_000 / term.perYear;
      const dates = couponDatesBetween({ nextOn: term.nextOn, perYear: term.perYear, payDay: term.payDay, maturesOn: term.maturesOn, from: shiftDays(today, -800), to: today });
      const own = byAccount.get(term.accountId) ?? [];
      holdings.push({
        securityId: term.accountId,
        title: value.name,
        currency: value.currency,
        unitsMicro: holdingPositionAfter(own, today).unitsMicro,
        unitsOn: (date) => holdingPositionAfter(own, date).unitsMicro,
        costBaseMinor: value.currency === base ? value.costMinor : null,
        valueBaseMinor: value.currency === base ? value.valueMinor : null,
        payments: dates.map((exDate) => ({ exDate, perShare: perUnit })),
      });
    }
    return dividendView({ holdings, today, baseCurrency: base, ratesToBase: rates });
  }, [portfolio, trades.data, history.data, listed, bonds, today, base, rates]);

  /*
   * Received this year: the history's estimate, reconciled with what was recorded as paid on each holding since
   * 1 January (`receivedThisYear` says how). A recorded payment is in the holding's currency; it is brought to base
   * at the page's rates, and one whose currency has no rate is left out rather than summed unconverted.
   */
  const received = useMemo(() => {
    if (!view) return null;
    const recorded: Record<string, number> = {};
    for (const holding of book.holdings) {
      const minor = book.year[holding.accountId]?.incomeMinor ?? 0;
      if (minor === 0) continue;
      const inBase = sumToBase({ amounts: [{ minor, currency: holding.currency }], baseCurrency: base, ratesToBase: rates }).totalMinor;
      if (inBase !== null) recorded[holding.accountId] = inBase;
    }
    const estimated = [
      ...listed.map(({ row, security }) => ({ accountIds: row.holdings.map((h) => h.accountId), minor: view.receivedBy[security.id] ?? 0 })),
      ...bonds.map(({ term }) => ({ accountIds: [term.accountId], minor: view.receivedBy[term.accountId] ?? 0 })),
    ];
    return receivedThisYear(estimated, recorded);
  }, [view, book.holdings, book.year, listed, bonds, base, rates]);

  return { portfolio, rates, isPending, error, trades, book, listed, bonds, bondIds, couponTerms, view, received };
}
