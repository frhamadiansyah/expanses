import { formatBps, formatMinor, formatPriceMicro, formatUnits, gainBps, priceMicroFrom, rateFromAmounts } from '@expanses/core';
import { type AccountRow, pocketParentIds, type TradeRow } from '@expanses/db';
import type { DayBalance } from '../accounts/balance-series';
import { heldLabel, quantityLabel, type Tile } from '../networth/asset-page';
import type { BrokerRow, HoldingLine, PortfolioView, StockRow } from './portfolio-view';
import { dayLabel, NO_BROKER } from './portfolio-view';

/**
 * The pure half of the stock and broker pages: what their read-only lines say, so the money in them is tested
 * rather than drawn and hoped for.
 */

/** A foreign stock in base: its gain against what was put in (each buy pinned on its day). Null without a rate or a cost. */
export function baseGainOf(stock: Pick<StockRow, 'valueBaseMinor' | 'costBaseMinor'>): { gainMinor: number; bps: number | null } | null {
  if (stock.valueBaseMinor === null || stock.costBaseMinor === null) return null;
  return { gainMinor: stock.valueBaseMinor - stock.costBaseMinor, bps: gainBps(stock.valueBaseMinor, stock.costBaseMinor) };
}

/**
 * The "Gain in {base}" row's words: the gain; or, with no rate for the stock's currency today, that rate named — never
 * a value of 0 and a −100% gain. Null (no row) when what was put in is not known: "Put in" already says so.
 */
export function baseGainLine(stock: Pick<StockRow, 'currency' | 'valueBaseMinor' | 'costBaseMinor'>, base: string): string | null {
  if (stock.costBaseMinor === null) return null;
  if (stock.valueBaseMinor === null) return `No ${stock.currency} rate yet`;
  const gain = baseGainOf(stock)!;
  return [gain.bps === null ? null : formatBps(gain.bps), formatMinor(gain.gainMinor, base)].filter(Boolean).join(' · ');
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
 * Up to ten trades across a stock's holdings, newest first — read-only: a trade is changed only on its holding's
 * page, which works later sells out again (spec §9).
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
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      // A buy that cost something but was pinned at 0 (the ledger's fallback) is unknown, never "Rp 0".
      const held = trade.kind === 'buy' && foreign ? (buyBaseMinor[trade.id] ?? null) : null;
      const pinned = held === 0 && cost > 0 ? null : held;
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

/** The stock page's reads, put together: the stock and its recent trades, each foreign buy with its pinned cost. */
export function securityPageModel(p: {
  view: PortfolioView;
  securityId: string;
  trades: readonly TradeRow[];
  buyBaseMinor: Readonly<Record<string, number>>;
  base: string;
}): { stock: StockRow; recent: RecentLine[] } | null {
  const stock = p.view.stocks.find((s) => s.securityId === p.securityId);
  if (!stock) return null;
  return { stock, recent: recentTrades(p.trades, stock, p.buyBaseMinor, p.base) };
}

/**
 * The one holding a stock is kept in, when there is only one: every way to the stock opens that holding's page, since
 * a page across brokers has nothing to add to one broker's.
 */
export const soleHolding = (stock: Pick<StockRow, 'holdings'>): string | null => (stock.holdings.length === 1 ? stock.holdings[0]!.accountId : null);

/**
 * The stock's line across its brokers: each holding's own line, day by day, added up. Null when there is none to add,
 * or when the lines do not share their days — never a line drawn from some of the holdings.
 */
export function combinedSeries(series: readonly (readonly DayBalance[])[]): DayBalance[] | null {
  const first = series[0];
  if (!first || series.some((one) => one.length !== first.length || one.some((day, i) => day.on !== first[i]!.on))) return null;
  return first.map((day, i) => ({ on: day.on, minor: series.reduce((sum, one) => sum + one[i]!.minor, 0) }));
}

/** What the stock paid this calendar year across its holdings: each dividend's own figure before tax, as its row reads. */
export function dividendsInYear(trades: readonly Pick<TradeRow, 'accountId' | 'kind' | 'occurredOn' | 'grossMinor'>[], accountIds: readonly string[], year: string): number {
  const held = new Set(accountIds);
  return trades.filter((t) => t.kind === 'income' && held.has(t.accountId) && t.occurredOn.startsWith(`${year}-`)).reduce((sum, t) => sum + t.grossMinor, 0);
}

/**
 * The four figures in the stock's card, across its brokers: the shares held, the average price over all of them, the
 * price (one security, one price), and what it has paid this year. A figure with nothing to say is left out.
 */
export function overallTiles(o: {
  stock: Pick<StockRow, 'unitsMicro' | 'costMinor' | 'currency' | 'lotSize'>;
  price: { priceMicro: number; label: string; info: string } | null;
  dividendsMinor: number | null;
}): Tile[] {
  const { stock } = o;
  const tiles: (Tile | null)[] = [
    { label: 'Shares', value: heldLabel(stock.unitsMicro, 'shares', stock.lotSize) },
    stock.unitsMicro > 0 ? { label: 'Average price', value: formatPriceMicro(priceMicroFrom(stock.costMinor, stock.unitsMicro), stock.currency) } : null,
    o.price ? { label: o.price.label, value: formatPriceMicro(o.price.priceMicro, stock.currency), info: o.price.info } : null,
    o.dividendsMinor === null ? null : { label: 'Dividends this year', value: formatMinor(o.dividendsMinor, stock.currency) },
  ];
  return tiles.filter((tile): tile is Tile => tile !== null);
}

/** A holding's row on the stock's page: "10 lots · avg Rp 8.750", and its own gain with the tone it is read in. */
export function institutionLine(h: Pick<HoldingLine, 'unitsMicro' | 'costMinor' | 'valueMinor' | 'currency'>, lotSize: number | null): { subtitle: string; gain: { text: string; tone: 'gain' | 'loss' | 'flat' } | null } {
  const avg = h.unitsMicro > 0 ? `avg ${formatPriceMicro(priceMicroFrom(h.costMinor, h.unitsMicro), h.currency)}` : null;
  const bps = gainBps(h.valueMinor, h.costMinor);
  return {
    subtitle: [quantityLabel(h.unitsMicro, 'shares', lotSize), avg].filter(Boolean).join(' · '),
    gain: bps === null ? null : { text: formatBps(bps), tone: bps > 0 ? 'gain' : bps < 0 ? 'loss' : 'flat' },
  };
}

export interface BrokerHoldingRow {
  holding: HoldingLine;
  title: string;
  /** A stock held at more than one place opens its stock page; one held here alone, or an unlinked holding, its asset page. */
  opens: { securityId: string } | { accountId: string };
}

/**
 * The broker page's reads, put together: the broker, its idle cash and a titled row per holding. On the no-broker
 * page, two holdings of one stock are each named ("No broker named · {holding}") — never "BBCA" twice.
 */
export function brokerPageModel(p: {
  view: PortfolioView;
  key: string;
  accounts: readonly AccountRow[];
  balances: Readonly<Record<string, number>> | undefined;
  base: string;
}): { broker: BrokerRow; cash: IdleCash[]; rows: BrokerHoldingRow[] } | null {
  const broker = p.view.brokers.find((b) => b.key === p.key);
  if (!broker) return null;
  const stockOf = (h: HoldingLine) => p.view.stocks.find((s) => s.holdings.some((line) => line.accountId === h.accountId));
  const rows = broker.holdings.map((holding): BrokerHoldingRow => {
    const stock = stockOf(holding);
    const shared = broker.key === NO_BROKER && !!stock && broker.holdings.some((other) => other.accountId !== holding.accountId && stock.holdings.some((line) => line.accountId === other.accountId));
    return {
      holding,
      title: shared ? `${holding.brokerName} · ${holding.name}` : (stock?.title ?? holding.name),
      // A stock at more than one place opens the stock across them; at this one alone, the holding itself.
      opens: stock?.securityId && stock.holdings.length > 1 ? { securityId: stock.securityId } : { accountId: holding.accountId },
    };
  });
  return { broker, cash: p.balances ? idleCash(broker, p.accounts, p.balances, p.base) : [], rows };
}
