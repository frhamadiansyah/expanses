import { describe, expect, it } from 'vitest';
import { depositLine, maturityLabel, rateLabel } from './deposit-terms';

describe('what a deposit says about itself', () => {
  it('says the day the money comes back and what it pays', () => {
    expect(depositLine({ maturesOn: '2027-03-01', rateBps: 625 })).toBe('Matures 1 Mar 2027 · 6,25%');
    expect(depositLine({ maturesOn: '2026-12-31', rateBps: 400 })).toBe('Matures 31 Dec 2026 · 4%');
  });

  it('leaves the rate off when nobody typed one', () => {
    expect(depositLine({ maturesOn: '2027-03-01', rateBps: 0 })).toBe('Matures 1 Mar 2027');
  });

  it('keeps a rate a whole percent cannot hold, in the decimal the form asks for', () => {
    expect(rateLabel(637)).toBe('6,37%');
    expect(rateLabel(1250)).toBe('12,5%');
  });

  it('falls back to the date as stored rather than showing nonsense', () => {
    expect(maturityLabel('')).toBe('');
    expect(maturityLabel('not a date')).toBe('not a date');
  });
});
