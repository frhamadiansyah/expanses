import { describe, expect, it } from 'vitest';
import { findAmounts, WORDS } from '../src/index';

const one = (t: string) => findAmounts(t, WORDS).map(({ minor, currency }) => ({ minor, currency }));

describe('findAmounts', () => {
  it.each([
    ['Rp38.000', 38_000, 'IDR'],
    ['Rp 1.250.000', 1_250_000, 'IDR'],
    ['Rp 1.250.000,00', 1_250_000, 'IDR'],
    ['IDR 1,250,000.00', 1_250_000, 'IDR'],
    ['50rb', 50_000, null],
    ['1,2jt', 1_200_000, null],
    ['$12.50', 1_250, 'USD'],
  ])('%s', (text, minor, currency) => expect(one(text)[0]).toEqual({ minor, currency }));

  it('finds both figures in order', () =>
    expect(one('Bayar Rp38.000, saldo Rp1.212.000').map((a) => a.minor)).toEqual([38_000, 1_212_000]));

  it('does not read a currency mark out of the end of a word', () => {
    expect(one('Kode confirm 123456')).toEqual([]);
    expect(one('Ref pidr 5000 tusd 20')).toEqual([]);
  });
});
