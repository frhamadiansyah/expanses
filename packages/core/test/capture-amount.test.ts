import { describe, expect, it } from 'vitest';
import { CURRENCIES, findAmounts, WORDS } from '../src/index';

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

describe('findAmounts keeps the exact figure of a currency with no minor unit', () => {
  const exact = (t: string) => findAmounts(t, WORDS).map(({ minor, currency, exactHundredths }) => ({ minor, currency, exactHundredths }));

  it('keeps the printed cents in hundredths beside the whole figure, which is still rounded to the nearest unit', () => {
    expect(exact('Rp12.500,30')[0]).toEqual({ minor: 12_500, currency: 'IDR', exactHundredths: 1_250_030 });
    expect(exact('Rp 12.500,50')[0]).toEqual({ minor: 12_501, currency: 'IDR', exactHundredths: 1_250_050 });
    expect(exact('IDR 12,345.67')[0]).toEqual({ minor: 12_346, currency: 'IDR', exactHundredths: 1_234_567 });
    expect(exact('¥1,250.5')[0]).toEqual({ minor: 1_251, currency: 'JPY', exactHundredths: 125_050 });
  });

  it('gives no exact figure when the cents are zero, absent, or the currency has its own decimals', () => {
    expect('exactHundredths' in findAmounts('Rp 1.250.000,00', WORDS)[0]!).toBe(false);
    expect('exactHundredths' in findAmounts('Rp38.000', WORDS)[0]!).toBe(false);
    expect('exactHundredths' in findAmounts('$12.50', WORDS)[0]!).toBe(false);
    expect('exactHundredths' in findAmounts('1,25rb', WORDS)[0]!).toBe(false);
  });
});

describe('findAmounts reads every currency the app keeps, by its code', () => {
  const exact = (t: string) => findAmounts(t, WORDS).map(({ minor, currency, exactHundredths }) => ({ minor, currency, exactHundredths }));

  it.each([
    ['KRW94.300,00', 94_300, 'KRW'],
    ['KRW 94,300', 94_300, 'KRW'],
    ['THB1.250,50', 125_050, 'THB'],
    ['VND 250.000', 250_000, 'VND'],
    ['HKD 88.40', 8_840, 'HKD'],
  ])('%s', (text, minor, currency) => expect(one(text)[0]).toEqual({ minor, currency }));

  it('reads a figure after the code of each currency in the table, scaled by that currency', () => {
    for (const { code, exponent } of CURRENCIES) {
      expect(one(`${code} 1,234.00`)[0], code).toEqual({ minor: 1_234 * 10 ** exponent, currency: code });
    }
  });

  it('keeps no exact figure for a whole won amount printed with zero cents, and keeps one when the cents are not zero', () => {
    expect('exactHundredths' in findAmounts('KRW94.300,00', WORDS)[0]!).toBe(false);
    expect(exact('KRW94.300,40')[0]).toEqual({ minor: 94_300, currency: 'KRW', exactHundredths: 9_430_040 });
  });

  it('reads the codes added from the table in capitals only: a word that happens to spell one is not money', () => {
    expect(one('Try 3 times, php 8 or newer')).toEqual([]);
    expect(one('krw 94.300')).toEqual([]);
    expect(one('Sar 12')).toEqual([]);
  });

  it('still reads the marks it always knew in any case', () => {
    expect(one('idr 5.000')[0]).toEqual({ minor: 5_000, currency: 'IDR' });
    expect(one('usd 12.50')[0]).toEqual({ minor: 1_250, currency: 'USD' });
    expect(one('rp38.000')[0]).toEqual({ minor: 38_000, currency: 'IDR' });
  });

  it('does not read a code out of a longer word, on either side', () => {
    expect(one('SKRW 5000')).toEqual([]);
    expect(one('KRWX 5000')).toEqual([]);
  });
});
