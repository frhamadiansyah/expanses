import { CapacitorHttp } from '@capacitor/core';
import { closePriceMicro, isoDate, type ListedPriceChoice, parseYahooChart, type YahooClose, yahooChartUrl, yahooSymbol } from '@expanses/core';
import { type Database, latestSecurityPrices, listHoldingLinks, listSecurities, recordListedClose, listSecurityPriceChoices, type WorkspaceContext } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { listedChoiceOf } from './price-sources';
import { YAHOO_PRICES_ENABLED } from './yahoo-switch';

/*
 * Yahoo Finance's end-of-day close, for now (see yahoo-switch.ts). Everything the app does with Yahoo is in this
 * file: the request, the daily fetch when the app opens, and the asset page's fetch and ↻.
 *
 * Yahoo sends no CORS header, so a page cannot read it with fetch. The iOS app asks through Capacitor's native HTTP —
 * `CapacitorHttp.get` for this request alone; the global fetch patch stays off, so every other request is unchanged.
 * In a plain browser CapacitorHttp falls back to window.fetch, which the browser blocks: the fetch fails quietly and
 * the last price stays. End-to-end tests answer that fetch with page.route.
 */

/** A GET that answers with the status and the parsed body. Swappable, so a test can answer for Yahoo. */
export type YahooGet = (url: string) => Promise<{ status: number; data: unknown }>;

const capacitorGet: YahooGet = async (url) => {
  const response = await CapacitorHttp.get({ url, responseType: 'json' });
  return { status: response.status, data: typeof response.data === 'string' ? JSON.parse(response.data) : response.data };
};

/** The latest finished close for a symbol, in `currency` — refused in any other. Throws when offline or refused. */
export async function fetchYahooClose(symbol: string, currency: string, get: YahooGet = capacitorGet, now: Date = new Date()): Promise<YahooClose> {
  if (!YAHOO_PRICES_ENABLED) throw new Error('Yahoo Finance is switched off');
  const response = await get(yahooChartUrl(symbol));
  if (response.status < 200 || response.status >= 300) throw new Error(`Yahoo Finance responded ${response.status}`);
  return parseYahooChart(response.data, { currency, now });
}

/* Once a day per symbol: the day each was last asked, kept in this browser. Only a convenience — lost, it asks again. */
const ASKED_KEY = 'yahoo-close-asked';
function askedToday(symbol: string, today: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(ASKED_KEY) ?? '{}') as Record<string, string>)[symbol] === today;
  } catch {
    return false;
  }
}
function markAsked(symbol: string, today: string): void {
  try {
    const asked = JSON.parse(localStorage.getItem(ASKED_KEY) ?? '{}') as Record<string, string>;
    localStorage.setItem(ASKED_KEY, JSON.stringify({ ...asked, [symbol]: today }));
  } catch {
    // No storage (a private window): it may ask again on the next open, which is harmless.
  }
}

/** A security the daily fetch looks at. */
interface Wanted {
  securityId: string;
  symbol: string;
  currency: string;
}

/**
 * Asks Yahoo for the close of every security held that follows it and has no price for today yet — each symbol once,
 * at most once a day, three at a time — and stores what comes back. A typed price for that day stays (the store keeps
 * it). A symbol that fails is left with its last price. Answers how many prices were saved.
 */
export async function refreshYahooCloses(database: Database, ws: WorkspaceContext, o: { get?: YahooGet; now?: Date } = {}): Promise<number> {
  if (!YAHOO_PRICES_ENABLED) return 0;
  const now = o.now ?? new Date();
  const today = isoDate(now);
  const [securities, links, choices, latest] = await Promise.all([listSecurities(database, ws), listHoldingLinks(database, ws), listSecurityPriceChoices(database, ws), latestSecurityPrices(database, ws)]);
  const held = new Set(links.map((link) => link.securityId));
  const wanted: Wanted[] = [];
  const seen = new Set<string>();
  for (const security of securities) {
    const symbol = yahooSymbol(security);
    if (!symbol || !held.has(security.id) || seen.has(symbol)) continue;
    if (listedChoiceOf(security, choices[security.id] ?? null) !== 'yahoo') continue;
    if ((latest[security.id]?.onDate ?? '') >= today || askedToday(symbol, today)) continue;
    seen.add(symbol);
    wanted.push({ securityId: security.id, symbol, currency: security.currency });
  }
  let saved = 0;
  const queue = [...wanted];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      markAsked(next.symbol, today);
      try {
        const close = await fetchYahooClose(next.symbol, next.currency, o.get, now);
        const result = await recordListedClose(database, ws, { securityId: next.securityId, onDate: close.onDate, priceMicro: closePriceMicro(close.close, next.currency), source: 'yahoo' });
        if (result === 'saved') saved += 1;
      } catch (error) {
        console.warn(`No Yahoo Finance close for ${next.symbol}`, error);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return saved;
}

/** When the app opens: the day's closes, behind every screen and never in front of one. */
export function useYahooClosesAtStart(): void {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!YAHOO_PRICES_ENABLED || !database) return;
    void refreshYahooCloses(database, ws)
      .then((saved) => (saved > 0 ? queryClient.invalidateQueries() : undefined))
      .catch((error: unknown) => console.warn('Yahoo Finance closes were not fetched', error));
    // Once per open workspace; the day's memo keeps a reopen from asking again.
  }, [database, ws.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type YahooFetch = 'idle' | 'fetching' | 'failed';

/**
 * The asset page's Yahoo close: fetched once when the page opens (if the security follows Yahoo, has no price for
 * today and was not asked today) and again on ↻, which always asks. Offline or refused, the last price stays with
 * its date and the state says the fetch failed, so the page can offer ↻ quietly.
 */
export function useYahooClose(o: {
  security: { id: string; ticker: string | null; market: string; currency: string } | null;
  choice: ListedPriceChoice | null;
  latest: { onDate: string } | null;
  ready: boolean;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [state, setState] = useState<YahooFetch>('idle');
  const asked = useRef(false);
  const symbol = o.security ? yahooSymbol(o.security) : null;
  const securityId = o.security?.id ?? null;
  const currency = o.security?.currency ?? '';

  const fetchNow = useCallback(async () => {
    if (!symbol || !securityId) return;
    setState('fetching');
    try {
      markAsked(symbol, isoDate());
      const close = await fetchYahooClose(symbol, currency);
      await recordListedClose(database, ws, { securityId, onDate: close.onDate, priceMicro: closePriceMicro(close.close, currency), source: 'yahoo' });
      await invalidate();
      setState('idle');
    } catch {
      setState('failed');
    }
  }, [database, ws, invalidate, symbol, securityId, currency]);

  const today = isoDate();
  const wanted = YAHOO_PRICES_ENABLED && o.ready && o.choice === 'yahoo' && symbol !== null && (o.latest === null || o.latest.onDate < today) && !askedToday(symbol, today);
  useEffect(() => {
    if (!wanted || asked.current) return;
    asked.current = true;
    void fetchNow();
  }, [wanted, fetchNow]);

  return { state, retry: () => void fetchNow() };
}
