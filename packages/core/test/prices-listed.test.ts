import { describe, expect, it } from 'vitest';
import { closePriceMicro, isIdxListing, listedPriceChoice, priceAgeDays } from '../src/index';

describe('the price source a listed share follows', () => {
  const idxShare = { yahoo: true, yahooSymbol: true, idx: true };
  it('is Yahoo Finance when nothing is saved and Yahoo can price it', () => {
    expect(listedPriceChoice(null, idxShare)).toBe('yahoo');
    expect(listedPriceChoice('idx', idxShare)).toBe('idx');
    expect(listedPriceChoice('typed', idxShare)).toBe('typed');
  });

  it('with Yahoo switched off, falls back to IDX’s file for an IDX share and to typing for anything else', () => {
    expect(listedPriceChoice(null, { ...idxShare, yahoo: false })).toBe('idx');
    expect(listedPriceChoice('yahoo', { ...idxShare, yahoo: false })).toBe('idx');
    expect(listedPriceChoice('yahoo', { yahoo: false, yahooSymbol: true, idx: false })).toBe('typed');
    expect(listedPriceChoice('typed', { ...idxShare, yahoo: false })).toBe('typed');
  });

  it('never picks IDX’s file for a share IDX does not list', () => {
    expect(listedPriceChoice('idx', { yahoo: true, yahooSymbol: true, idx: false })).toBe('typed');
    expect(isIdxListing({ ticker: 'BBCA', market: 'IDX', currency: 'IDR' })).toBe(true);
    expect(isIdxListing({ ticker: 'AAPL', market: 'NASDAQ', currency: 'USD' })).toBe(false);
    expect(isIdxListing({ ticker: null, market: 'IDX', currency: 'IDR' })).toBe(false);
  });

  it('counts a price’s age in whole days', () => {
    expect(priceAgeDays('2026-09-21', '2026-09-30')).toBe(9);
  });
});

describe('a close as a stored price', () => {
  it('is millionths of the minor unit: whole rupiah, cents for dollars', () => {
    expect(closePriceMicro(6150, 'IDR')).toBe(6_150_000_000);
    expect(closePriceMicro(227.63, 'USD')).toBe(22_763_000_000);
  });
});
