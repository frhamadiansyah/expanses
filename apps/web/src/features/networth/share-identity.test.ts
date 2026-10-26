import { describe, expect, it } from 'vitest';
import { custodianLine, tickerLocked } from './share-identity';

describe('tickerLocked', () => {
  it('is open before the first trade', () => {
    expect(tickerLocked(true, 0)).toBe(false);
  });
  it('is fixed once the share has any trade', () => {
    expect(tickerLocked(true, 1)).toBe(true);
    expect(tickerLocked(true, 12)).toBe(true);
  });
  it('is held fixed while the trades are still being read', () => {
    expect(tickerLocked(true, null)).toBe(true);
  });
  it('lets a share recorded before tickers be given one', () => {
    expect(tickerLocked(false, 3)).toBe(false);
  });
});

describe('custodianLine', () => {
  it('names the broker’s bank', () => {
    expect(custodianLine(' Bank Mandiri ')).toBe('Bank Mandiri');
  });
  it('says when none is named', () => {
    expect(custodianLine(null)).toBe('Not set');
    expect(custodianLine('  ')).toBe('Not set');
  });
});
