import { CURRENCIES, type CurrencyInfo, searchCurrencies } from '@expanses/core';

/** Where the currency sheet keeps the codes starred on this device. */
export const FAVORITE_CURRENCY_KEY = 'expanses.currency.favorites';

/** The fixed Popular block, the same for everyone. */
export const POPULAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'CNY', 'AUD'] as const;

const known = (code: string) => !!code && CURRENCIES.some((c) => c.code === code);

/**
 * The starred codes. Never stored yet: the workspace's own currency, so the block is never empty the first time.
 * A blocked or corrupt store reads as that same seed; codes no longer in `CURRENCIES` are dropped.
 */
export function readFavoriteCurrencies(baseCurrency: string): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_CURRENCY_KEY);
    if (raw === null) return known(baseCurrency) ? [baseCurrency] : [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((code): code is string => typeof code === 'string' && known(code)) : [];
  } catch {
    return known(baseCurrency) ? [baseCurrency] : [];
  }
}

/** Stars or unstars a code and keeps the result; returns the new list. A browser that refuses storage still gets the list. */
export function toggleFavoriteCurrency(code: string, current: readonly string[]): string[] {
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
  try {
    localStorage.setItem(FAVORITE_CURRENCY_KEY, JSON.stringify(next));
  } catch {
    // Not remembered, still shown.
  }
  return next;
}

export interface CurrencySection {
  /** What the grey header says: Favorites, Recent, Popular or a letter. */
  title: string;
  codes: string[];
}

/**
 * The sheet's sections. Favorites first, Recent without what Favorites already shows, Popular without what either
 * shows, then A–Z by the first letter of the code with every currency. `exclude` and `only` narrow every section.
 */
export function currencySections({
  favorites,
  recent,
  exclude = [],
  only,
}: {
  favorites: readonly string[];
  recent: readonly string[];
  exclude?: readonly string[];
  only?: readonly string[];
}): CurrencySection[] {
  const offered = (code: string) => known(code) && !exclude.includes(code) && (!only || only.includes(code));
  const seen = new Set<string>();
  const take = (codes: readonly string[]) => {
    const out = codes.filter((c) => offered(c) && !seen.has(c));
    for (const c of out) seen.add(c);
    return out;
  };
  const sections: CurrencySection[] = [];
  for (const [title, codes] of [
    ['Favorites', favorites],
    ['Recent', recent],
    ['Popular', POPULAR_CURRENCIES],
  ] as const) {
    const list = [...new Set(take(codes))];
    if (list.length) sections.push({ title, codes: list });
  }
  const letters = new Map<string, string[]>();
  for (const c of [...CURRENCIES].sort((a, b) => a.code.localeCompare(b.code))) {
    if (!offered(c.code)) continue;
    const letter = c.code[0]!;
    letters.set(letter, [...(letters.get(letter) ?? []), c.code]);
  }
  for (const [title, codes] of letters) sections.push({ title, codes });
  return sections;
}

/** The flat list shown while a search is typed: no sections, `exclude` and `only` still applied. */
export function currencyMatches(query: string, { exclude = [], only }: { exclude?: readonly string[]; only?: readonly string[] } = {}): CurrencyInfo[] {
  return searchCurrencies(query).filter((c) => !exclude.includes(c.code) && (!only || only.includes(c.code)));
}
