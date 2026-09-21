import { type AssetKind, formatBps, formatLots, gainBps, percentShares, portfolioSummary, type PortfolioSummary, type Position, sumToBase, unitsValueMinor } from '@expanses/core';
import type { AccountRow, AssetProfileRow, AssetValueRow, HoldingLinkRow, SecurityRow } from '@expanses/db';

export const NO_BROKER = 'none';
/** Unlinked holdings that belong on Investments. Gold and bonds stay on the Assets page (spec §7.1). */
const LISTED_KINDS: readonly AssetKind[] = ['stock', 'fund'];

export interface HoldingLine {
  accountId: string;
  name: string;
  brokerAccountId: string | null;
  brokerName: string;
  currency: string;
  unitsMicro: number;
  valueMinor: number;
  costMinor: number;
  costBaseMinor: number;
  /** The owner should type a fresh price — the Assets page's own flag. */
  stale: boolean;
}

export interface StockRow {
  key: string;
  securityId: string | null;
  /** Set for an unlinked holding: its row opens the asset page. */
  accountId: string | null;
  title: string;
  name: string;
  market: string | null;
  currency: string;
  lotSize: number | null;
  unitsMicro: number;
  valueMinor: number;
  costMinor: number;
  costBaseMinor: number;
  /** In base through `sumToBase`; null when there is no rate for its currency. For ordering only — the row draws `approxLine`. */
  valueBaseMinor: number | null;
  gainBps: number | null;
  stale: boolean;
  holdings: HoldingLine[];
}

export interface BrokerRow {
  key: string;
  accountId: string | null;
  name: string;
  holdings: HoldingLine[];
  /** The one currency every holding here is in, and their total in it — or both null when there are two. */
  currency: string | null;
  valueMinor: number | null;
  /** Everything here in base (`sumToBase`): null with the missing rates named, never the rest summed. */
  total: { totalMinor: number | null; missing: string[] };
  costBaseMinor: number;
  /** Floor and remainder to the largest (the owner's ruling); null unless every broker could be added up. */
  sharePercent: number | null;
}

export interface PortfolioView {
  summary: PortfolioSummary;
  stocks: StockRow[];
  brokers: BrokerRow[];
}

export interface PortfolioInputs {
  values: readonly AssetValueRow[];
  profiles: readonly AssetProfileRow[];
  links: readonly HoldingLinkRow[];
  securities: readonly SecurityRow[];
  accounts: readonly AccountRow[];
  baseCosts: Readonly<Record<string, Position>>;
  baseCurrency: string;
  /** The rates this device holds for today (`useHeldRates`) — the ones the Assets page adds up with. */
  ratesToBase: Readonly<Record<string, number>>;
}

const byBaseValue = <T extends { valueBaseMinor: number | null }>(a: T, b: T) => (b.valueBaseMinor ?? -1) - (a.valueBaseMinor ?? -1);

export function portfolioView(p: PortfolioInputs): PortfolioView {
  const linkOf = new Map(p.links.map((l) => [l.accountId, l]));
  const securityOf = new Map(p.securities.map((s) => [s.id, s]));
  const kindOf = new Map(p.profiles.map((profile) => [profile.accountId, profile.assetKind]));
  const accountOf = new Map(p.accounts.map((a) => [a.id, a]));
  const inBase = (amounts: readonly { minor: number; currency: string }[]) => sumToBase({ amounts, baseCurrency: p.baseCurrency, ratesToBase: p.ratesToBase });

  const lines: (HoldingLine & { securityId: string | null })[] = [];
  for (const value of p.values) {
    if (value.mode !== 'market' || (value.unitsMicro ?? 0) <= 0) continue;
    const link = linkOf.get(value.accountId);
    if (!link?.securityId && !LISTED_KINDS.includes(kindOf.get(value.accountId) ?? 'other')) continue;
    const brokerAccountId = link?.brokerAccountId ?? null;
    lines.push({
      accountId: value.accountId,
      name: value.name,
      securityId: link?.securityId ?? null,
      brokerAccountId,
      brokerName: brokerAccountId ? (accountOf.get(brokerAccountId)?.name ?? 'Broker') : 'No broker named',
      currency: value.currency,
      unitsMicro: value.unitsMicro ?? 0,
      valueMinor: value.valueMinor,
      costMinor: value.costMinor,
      costBaseMinor: value.currency === p.baseCurrency ? value.costMinor : (p.baseCosts[value.accountId]?.costMinor ?? 0),
      stale: value.stale,
    });
  }

  const stocksByKey = new Map<string, StockRow>();
  for (const line of lines) {
    const key = line.securityId ?? `account:${line.accountId}`;
    const security = line.securityId ? securityOf.get(line.securityId) : undefined;
    const row = stocksByKey.get(key) ?? {
      key, securityId: line.securityId, accountId: line.securityId ? null : line.accountId,
      title: security ? (security.ticker ?? security.name) : line.name, name: security?.name ?? line.name, market: security?.market || null,
      currency: line.currency, lotSize: security?.lotSize ?? null, unitsMicro: 0, valueMinor: 0, costMinor: 0, costBaseMinor: 0,
      valueBaseMinor: null, gainBps: null, stale: false, holdings: [],
    };
    // One security, one currency (linkHolding refuses another), so these are same-currency sums.
    row.unitsMicro += line.unitsMicro;
    row.valueMinor += line.valueMinor;
    row.costMinor += line.costMinor;
    row.costBaseMinor += line.costBaseMinor;
    row.stale ||= line.stale;
    row.holdings.push(line);
    stocksByKey.set(key, row);
  }
  const stocks = [...stocksByKey.values()].map((row) => ({
    ...row,
    valueBaseMinor: inBase([{ minor: row.valueMinor, currency: row.currency }]).totalMinor,
    gainBps: gainBps(row.valueMinor, row.costMinor),
  }));
  stocks.sort((a, b) => byBaseValue(a, b) || a.title.localeCompare(b.title));

  const brokersByKey = new Map<string, HoldingLine[]>();
  for (const line of lines) {
    const key = line.brokerAccountId ?? NO_BROKER;
    brokersByKey.set(key, [...(brokersByKey.get(key) ?? []), line]);
  }
  const brokers: BrokerRow[] = [...brokersByKey].map(([key, holdings]) => {
    const currencies = new Set(holdings.map((h) => h.currency));
    const single = currencies.size === 1 ? [...currencies][0]! : null;
    return {
      key,
      accountId: key === NO_BROKER ? null : key,
      name: holdings[0]!.brokerName,
      holdings,
      currency: single,
      valueMinor: single ? holdings.reduce((sum, h) => sum + h.valueMinor, 0) : null,
      total: inBase(holdings.map((h) => ({ minor: h.valueMinor, currency: h.currency }))),
      costBaseMinor: holdings.reduce((sum, h) => sum + h.costBaseMinor, 0),
      sharePercent: null,
    };
  });
  const byTotal = (a: BrokerRow, b: BrokerRow) => (b.total.totalMinor ?? -1) - (a.total.totalMinor ?? -1);
  brokers.sort((a, b) => byTotal(a, b) || a.name.localeCompare(b.name));
  // A share is of a whole: with any broker unconvertible there is no whole, so no broker gets a share.
  if (brokers.every((b) => b.total.totalMinor !== null)) {
    percentShares(brokers.map((b) => b.total.totalMinor!)).forEach((share, i) => {
      brokers[i]!.sharePercent = share;
    });
  }

  return {
    summary: portfolioSummary(lines.map((l) => ({ currency: l.currency, valueMinor: l.valueMinor, costMinor: l.costMinor, costBaseMinor: l.costBaseMinor })), p.baseCurrency, p.ratesToBase),
    stocks,
    brokers,
  };
}

/** The price page's "This changes": each holding at the new price, and its move from the last one. */
export function priceChangeLines(holdings: readonly HoldingLine[], lastPriceMicro: number | null, newPriceMicro: number) {
  return holdings.map((holding) => {
    const valueMinor = unitsValueMinor(holding.unitsMicro, newPriceMicro);
    return { holding, valueMinor, changeMinor: lastPriceMicro === null ? null : valueMinor - unitsValueMinor(holding.unitsMicro, lastPriceMicro) };
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "8 Mar 2025" — built by hand, since en-GB writes "Sept" on some engines and the day must never shift a zone. */
export const dayLabel = (isoDay: string): string => `${Number(isoDay.slice(8, 10))} ${MONTHS[Number(isoDay.slice(5, 7)) - 1]} ${isoDay.slice(0, 4)}`;

/**
 * Where a stock is kept, in words: one broker by name, several counted. Two holdings with no broker named are two
 * holdings, never two brokers — each is still its own line on the stock page until it is told where it is kept.
 */
export function keptAt(row: StockRow): string {
  const brokers = new Set(row.holdings.map((h) => h.brokerAccountId ?? NO_BROKER));
  if (brokers.size > 1) return `${brokers.size} brokers`;
  const one = row.holdings[0]!.brokerName;
  return row.holdings.length > 1 ? `${one} · ${row.holdings.length} holdings` : one;
}

/** "15 lot (1.500 shares) · 2 brokers · +9,0% · Update price" — the stock row's subtitle, phone and desktop alike. */
export function stockSubtitle(row: StockRow): string {
  const gain = row.gainBps === null ? null : formatBps(row.gainBps);
  // The Assets page's own words for a price that needs typing again.
  return [formatLots(row.unitsMicro, row.lotSize ?? 1), keptAt(row), gain, row.stale ? 'Update price' : null].filter(Boolean).join(' · ');
}

/** "2 holdings · USD · 71%" — the currency only when there is one, the share only when there is a whole. */
export function brokerSubtitle(row: BrokerRow): string {
  const count = `${row.holdings.length} ${row.holdings.length === 1 ? 'holding' : 'holdings'}`;
  return [count, row.currency, row.sharePercent === null ? null : `${row.sharePercent}%`].filter(Boolean).join(' · ');
}
