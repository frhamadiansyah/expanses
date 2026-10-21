/*
 * Yahoo Finance's end-of-day close for a listed share. For now only: Yahoo's terms do not allow commercial use, so
 * this is replaced by IDX's file or a licensed feed before the app is sold. Everything Yahoo-specific in core is in
 * this file; deleting it (and the app's own yahoo module) removes the source.
 */

/** The chart endpoint: five daily bars, no key. */
export function yahooChartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
}

/** US markets Yahoo quotes under the plain ticker. */
const US_MARKETS = new Set(['NASDAQ', 'NYSE', 'NYSE ARCA', 'NYSE AMERICAN', 'CBOE BZX', 'IEX']);

/**
 * The symbol Yahoo knows a security by: an IDX share is `BBCA.JK`, a US one its plain ticker with a class written
 * with a dash (BRK.B is `BRK-B`). Null for a security Yahoo is not asked about: no ticker, or another market. Mutual
 * funds have no ticker, so they never reach Yahoo.
 */
export function yahooSymbol(security: { ticker: string | null; market: string; currency: string }): string | null {
  const ticker = security.ticker?.trim().toUpperCase();
  if (!ticker) return null;
  if (security.market === 'IDX' || (security.market === '' && security.currency === 'IDR')) return `${ticker}.JK`;
  if (US_MARKETS.has(security.market) && security.currency === 'USD') return ticker.replace('.', '-');
  return null;
}

export class YahooPriceError extends Error {}

/** One day's close, on the exchange's own calendar. */
export interface YahooClose {
  onDate: string;
  close: number;
}

interface ChartMeta {
  currency?: string;
  exchangeTimezoneName?: string;
  gmtoffset?: number;
  currentTradingPeriod?: { regular?: { end?: number } };
}

/** The exchange's date at a moment, in its own timezone (Asia/Jakarta for IDX). */
function exchangeDate(seconds: number, meta: ChartMeta): string {
  if (meta.exchangeTimezoneName) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(seconds * 1000));
    } catch {
      // An unknown zone name: the fixed offset below says the same for the day it is quoted on.
    }
  }
  return new Date((seconds + (meta.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
}

/**
 * The last completed daily close in a chart payload, refused unless it is in `currency`.
 *
 * The close-date rule: bars are read newest first, skipping any with no close (Yahoo sends null for a day with no
 * trade). A bar dated before today, in the exchange's timezone, is a finished day. Today's bar counts only once the
 * regular session is over — `now` at or after `meta.currentTradingPeriod.regular.end` — because until then its
 * "close" is the latest trade, a live price, not the day's close. (Yahoo's `regularMarketTime` can sit a few seconds
 * before the session end even after the close, so the session end is read against the clock, not against it.)
 */
export function parseYahooChart(body: unknown, o: { currency: string; now: Date }): YahooClose {
  const result = (body as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | { meta?: ChartMeta; timestamp?: unknown[]; indicators?: { quote?: { close?: unknown[] }[] } }
    | undefined;
  if (!result?.meta) throw new YahooPriceError('Yahoo Finance sent no chart');
  const { meta } = result;
  if (meta.currency !== o.currency) throw new YahooPriceError(`Yahoo Finance quotes this in ${meta.currency ?? 'no currency'}; the holding is in ${o.currency}`);
  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const nowSeconds = o.now.getTime() / 1000;
  const today = exchangeDate(nowSeconds, meta);
  const end = meta.currentTradingPeriod?.regular?.end;
  const sessionOver = typeof end === 'number' && nowSeconds >= end;
  for (let i = Math.min(stamps.length, closes.length) - 1; i >= 0; i -= 1) {
    const stamp = stamps[i];
    const close = closes[i];
    if (typeof stamp !== 'number' || typeof close !== 'number' || !(close > 0)) continue;
    const onDate = exchangeDate(stamp, meta);
    if (onDate > today || (onDate === today && !sessionOver)) continue;
    return { onDate, close };
  }
  throw new YahooPriceError('Yahoo Finance has no finished close yet');
}

/** The same chart endpoint asked for dividends: two years of monthly bars, so last calendar year is whole. */
export function yahooDividendsUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1mo&events=div`;
}

/** One dividend as Yahoo lists it: the ex-dividend day, on the exchange's calendar, and the amount per share. */
export interface YahooDividend {
  exDate: string;
  perShare: number;
}

/**
 * Every dividend in a chart payload, oldest first, refused unless quoted in `currency`. A payload with no
 * `events.dividends` is a security that paid none in the range: an empty list, not an error.
 */
export function parseYahooDividends(body: unknown, o: { currency: string }): YahooDividend[] {
  const result = (body as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | { meta?: ChartMeta; events?: { dividends?: Record<string, { amount?: unknown; date?: unknown }> } }
    | undefined;
  if (!result?.meta) throw new YahooPriceError('Yahoo Finance sent no chart');
  if (result.meta.currency !== o.currency) throw new YahooPriceError(`Yahoo Finance quotes this in ${result.meta.currency ?? 'no currency'}; the holding is in ${o.currency}`);
  const out: YahooDividend[] = [];
  for (const entry of Object.values(result.events?.dividends ?? {})) {
    if (typeof entry.date !== 'number' || typeof entry.amount !== 'number' || !(entry.amount > 0)) continue;
    out.push({ exDate: exchangeDate(entry.date, result.meta), perShare: entry.amount });
  }
  return out.sort((a, b) => a.exDate.localeCompare(b.exDate));
}
