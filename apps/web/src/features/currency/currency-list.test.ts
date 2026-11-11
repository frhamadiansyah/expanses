import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currencyMatches, currencySections, FAVORITE_CURRENCY_KEY, readFavoriteCurrencies, toggleFavoriteCurrency } from './currency-list';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    clear: () => store.clear(),
  });
});

describe('favorite currencies', () => {
  it('start as the workspace currency when nothing was ever stored', () => {
    expect(readFavoriteCurrencies('IDR')).toEqual(['IDR']);
  });
  it('toggle on and off and persist', () => {
    let list = readFavoriteCurrencies('IDR');
    list = toggleFavoriteCurrency('EUR', list);
    expect(list).toEqual(['IDR', 'EUR']);
    expect(readFavoriteCurrencies('USD')).toEqual(['IDR', 'EUR']);
    list = toggleFavoriteCurrency('IDR', list);
    list = toggleFavoriteCurrency('EUR', list);
    expect(readFavoriteCurrencies('IDR')).toEqual([]);
  });
  it('an emptied list stays empty rather than re-seeding', () => {
    toggleFavoriteCurrency('IDR', ['IDR']);
    expect(localStorage.getItem(FAVORITE_CURRENCY_KEY)).toBe('[]');
    expect(readFavoriteCurrencies('IDR')).toEqual([]);
  });
  it('survives a corrupt store and unknown codes', () => {
    localStorage.setItem(FAVORITE_CURRENCY_KEY, '{nope');
    expect(readFavoriteCurrencies('SGD')).toEqual(['SGD']);
    localStorage.setItem(FAVORITE_CURRENCY_KEY, '["XXX","JPY"]');
    expect(readFavoriteCurrencies('SGD')).toEqual(['JPY']);
  });
});

describe('currency sections', () => {
  const titles = (s: ReturnType<typeof currencySections>) => s.map((x) => x.title);
  it('puts favorites, recent and popular first without repeating a code among them', () => {
    const s = currencySections({ favorites: ['IDR', 'USD'], recent: ['USD', 'THB', 'IDR'], });
    expect(s[0]).toEqual({ title: 'Favorites', codes: ['IDR', 'USD'] });
    expect(s[1]).toEqual({ title: 'Recent', codes: ['THB'] });
    expect(s[2]!.title).toBe('Popular');
    expect(s[2]!.codes).toEqual(['EUR', 'GBP', 'JPY', 'SGD', 'CNY', 'AUD']);
  });
  it('hides empty sections and lists every currency under its letter', () => {
    const s = currencySections({ favorites: [], recent: [] });
    expect(titles(s).slice(0, 2)).toEqual(['Popular', 'A']);
    expect(s.find((x) => x.title === 'S')!.codes).toEqual(['SAR', 'SGD']);
    expect(s.find((x) => x.title === 'U')!.codes).toContain('USD');
  });
  it('drops excluded codes everywhere and honours only', () => {
    const s = currencySections({ favorites: ['IDR'], recent: [], exclude: ['IDR', 'USD'] });
    expect(s.flatMap((x) => x.codes)).not.toContain('IDR');
    expect(s.flatMap((x) => x.codes)).not.toContain('USD');
    const only = currencySections({ favorites: ['IDR'], recent: [], only: ['IDR', 'JPY'] });
    expect(only.map((x) => x.title)).toEqual(['Favorites', 'Popular', 'I', 'J']);
  });
});

describe('search results', () => {
  it('finds by country and respects exclude', () => {
    expect(currencyMatches('japan').map((c) => c.code)).toEqual(['JPY']);
    expect(currencyMatches('japan', { exclude: ['JPY'] })).toEqual([]);
  });
});
