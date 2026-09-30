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
