import { describe, expect, it } from 'vitest';
import { findAmounts, WORDS } from '../src/index';

const one = (t: string) => findAmounts(t, WORDS).map(({ minor, currency }) => ({ minor, currency }));

describe('findAmounts', () => {
  it.each([
    ['Rp38.000', 3_800_000, 'IDR'],
    ['Rp 1.250.000', 125_000_000, 'IDR'],
    ['Rp 1.250.000,00', 125_000_000, 'IDR'],
    ['IDR 1,250,000.00', 125_000_000, 'IDR'],
    ['50rb', 5_000_000, null],
    ['1,2jt', 120_000_000, null],
    ['$12.50', 1_250, 'USD'],
  ])('%s', (text, minor, currency) => expect(one(text)[0]).toEqual({ minor, currency }));

  it('finds both figures in order', () =>
    expect(one('Bayar Rp38.000, saldo Rp1.212.000').map((a) => a.minor)).toEqual([3_800_000, 121_200_000]));
});
