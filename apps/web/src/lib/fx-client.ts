import { gramPriceMicroFromOunce, PRICE_SCALE } from '@expanses/core';
import type { RateFetcher } from '@expanses/db';

interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

/** Frankfurter v2: GET /v2/rates?date=YYYY-MM-DD&base=FROM&quotes=TO -> [{date, base, quote, rate}] */
export function frankfurterFetcher(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): RateFetcher {
  return async (from, to, onDate) => {
    const url = `https://api.frankfurter.dev/v2/rates?date=${onDate}&base=${from}&quotes=${to}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
    const body = (await res.json()) as FrankfurterRate[];
    const match = Array.isArray(body) ? body.find((r) => r.base === from && r.quote === to) : undefined;
    if (!match || !(match.rate > 0)) throw new Error(`No ${from}->${to} rate for ${onDate}`);
    return { rate: match.rate, sourceDate: match.date };
  };
}

/**
 * The world gold price: what one troy ounce of gold (XAU) is worth in `currency` on `onDate`, from the same service
 * and in the same shape as the exchange rates. Plain `fetch`, as the rates are — it answers with CORS headers.
 */
export async function worldGoldPerOunce(currency: string, onDate: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<number> {
  const res = await fetchImpl(`https://api.frankfurter.dev/v2/rates?date=${onDate}&base=XAU&quotes=${currency}`);
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
  const body = (await res.json()) as FrankfurterRate[];
  const match = Array.isArray(body) ? body.find((r) => r.base === 'XAU' && r.quote === currency) : undefined;
  if (!match || !(match.rate > 0)) throw new Error(`No world gold price in ${currency} for ${onDate}`);
  return match.rate;
}

/** One day of the world gold price, brought down to a gram: in the currency's minor units, as a stored price is. */
export interface GoldDay {
  on: string;
  minor: number;
}

/** Past this many days a series keeps one day a week, so five years of gold draws as about 260 points, not 1 800. */
const WEEKLY_PAST_DAYS = 731;

const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/**
 * One point a week, the week's last — Monday to Sunday — so a long series stays light to draw and still ends on the
 * newest day it has. Oldest first, as it is given.
 */
export function thinWeekly<T extends { on: string }>(days: readonly T[]): T[] {
  // 1 Jan 1970 was a Thursday: three days on, every week starts on a Monday.
  const week = (iso: string) => Math.floor((dayNumber(iso) + 3) / 7);
  return days.filter((day, index) => index === days.length - 1 || week(days[index + 1]!.on) !== week(day.on));
}

/**
 * The world gold price per gram in `currency`, day by day from `from` to `to`, from the same service and in the same
 * shape as `worldGoldPerOunce` — the time series form of the one query. Oldest first; past two years, a day a week.
 */
export async function worldGoldSeries(currency: string, from: string, to: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<GoldDay[]> {
  const res = await fetchImpl(`https://api.frankfurter.dev/v2/rates?from=${from}&to=${to}&base=XAU&quotes=${currency}`);
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
  const body = (await res.json()) as FrankfurterRate[];
  if (!Array.isArray(body)) throw new Error(`No world gold prices in ${currency}`);
  const days = body
    .filter((r) => r.base === 'XAU' && r.quote === currency && r.rate > 0 && r.date >= from && r.date <= to)
    .map((r) => ({ on: r.date, minor: gramPriceMicroFromOunce(r.rate, currency) / PRICE_SCALE }))
    .sort((a, b) => a.on.localeCompare(b.on));
  return dayNumber(to) - dayNumber(from) > WEEKLY_PAST_DAYS ? thinWeekly(days) : days;
}
