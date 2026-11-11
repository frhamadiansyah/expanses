import { describe, expect, it } from 'vitest';
import { CURRENCIES, searchCurrencies } from '../src/index';

const codes = (q: string) => searchCurrencies(q).map((c) => c.code);

describe('searching currencies', () => {
  it('finds a currency by its country', () => {
    expect(codes('japan')).toEqual(['JPY']);
    expect(codes('germany')).toEqual(['EUR']);
    expect(codes('ecuador')).toEqual(['USD']);
  });
  it('finds by name, code and symbol', () => {
    expect(codes('rupiah')).toContain('IDR');
    expect(codes('s$')).toEqual(['SGD']);
    expect(codes('eur')[0]).toBe('EUR');
  });
  it('ignores case and padding, and an empty query lists all', () => {
    expect(codes('  JAPAN ')).toEqual(['JPY']);
    expect(searchCurrencies('')).toHaveLength(CURRENCIES.length);
  });
  it('gives every currency at least one country', () => {
    expect(CURRENCIES.filter((c) => c.countries.length === 0)).toEqual([]);
  });
});
