import { formatUnits, gainBps, rateFromAmounts } from '@expanses/core';
import { type AccountRow, pocketParentIds, type TradeRow } from '@expanses/db';
import type { BrokerRow, StockRow } from './portfolio-view';
import { dayLabel } from './portfolio-view';

/**
 * The pure half of the stock and broker pages: what their read-only lines say, so the money in them is tested
 * rather than drawn and hoped for.
 */

/** A foreign stock in base: its gain against what was put in (each buy pinned on its day). Null without a rate or a cost. */
export function baseGainOf(stock: Pick<StockRow, 'valueBaseMinor' | 'costBaseMinor'>): { gainMinor: number; bps: number | null } | null {
  if (stock.valueBaseMinor === null || stock.costBaseMinor === null) return null;
  return { gainMinor: stock.valueBaseMinor - stock.costBaseMinor, bps: gainBps(stock.valueBaseMinor, stock.costBaseMinor) };
}

/** "Bought at": base cost over native cost — the blended rate of every buy still held. Null when either is nothing. */
export function boughtAtRate(stock: Pick<StockRow, 'currency' | 'costMinor' | 'costBaseMinor'>, base: string): number | null {
  if (stock.currency === base || stock.costBaseMinor === null || !(stock.costMinor > 0) || !(stock.costBaseMinor > 0)) return null;
  return rateFromAmounts(stock.costMinor, stock.currency, stock.costBaseMinor, base);
}

const KIND = { buy: 'Bought', sell: 'Sold', income: 'Income', unit_change: 'Units changed' } as const;

export interface RecentLine {
  id: string;
  accountId: string;
  title: string;
  brokerName: string;
  day: string;
  /** The trade's own figure, in the holding's currency: what was paid or received before fees. */
  grossMinor: number;
  currency: string;
  /** A foreign buy's cost in base, pinned by the ledger on its day; null for anything else. */
  pinnedBaseMinor: number | null;
  /** The rate that pin implies, for "at 15.800 IDR per 1 USD". */
  pinnedRate: number | null;
}

/**
 * Up to ten trades across a stock's holdings, newest first — read-only: a trade is changed only on Buy & sell,
 * which works later sells out again (spec §9).
 */
export function recentTrades(
  trades: readonly TradeRow[],
  stock: Pick<StockRow, 'holdings' | 'currency'>,
  buyBaseMinor: Readonly<Record<string, number>>,
  base: string,
  limit = 10,
): RecentLine[] {
  const brokerOf = new Map(stock.holdings.map((h) => [h.accountId, h.brokerName]));
  const foreign = stock.currency !== base;
  return trades
    .filter((t) => brokerOf.has(t.accountId))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((trade) => {
      const pinned = trade.kind === 'buy' && foreign ? (buyBaseMinor[trade.id] ?? null) : null;
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      return {
        id: trade.id,
        accountId: trade.accountId,
        title: trade.kind === 'buy' || trade.kind === 'sell' ? `${KIND[trade.kind]} ${formatUnits(trade.unitsMicro)} shares` : KIND[trade.kind],
        brokerName: brokerOf.get(trade.accountId)!,
        day: dayLabel(trade.occurredOn),
        grossMinor: trade.grossMinor,
        currency: stock.currency,
        pinnedBaseMinor: pinned,
        pinnedRate: pinned !== null && pinned > 0 && cost > 0 ? rateFromAmounts(cost, stock.currency, pinned, base) : null,
      };
    });
}

export interface IdleCash {
  accountId: string;
  label: string;
  currency: string;
  minor: number;
}

/**
 * A broker's idle cash, each in its own currency and never converted: the broker account itself, or — a `fund`
 * account holding pockets (`pocketParentIds`, the rule every pocket screen asks) — one line per open pocket, since
 * a parent holds nothing. Holdings kept with no broker have no cash to show.
 */
export function idleCash(broker: Pick<BrokerRow, 'accountId'>, accounts: readonly AccountRow[], balances: Readonly<Record<string, number>>, base: string): IdleCash[] {
  if (broker.accountId === null) return [];
  const own = accounts.find((a) => a.id === broker.accountId);
  if (!own) return [];
  const holders = pocketParentIds(accounts).has(own.id) ? accounts.filter((a) => a.parentId === own.id && a.archivedAt === null) : [own];
  return holders.map((a) => {
    const currency = a.currency ?? base;
    return { accountId: a.id, label: holders.length > 1 ? `Cash idle · ${currency}` : 'Cash idle', currency, minor: balances[a.id] ?? 0 };
  });
}
