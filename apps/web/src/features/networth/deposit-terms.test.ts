import { describe, expect, it } from 'vitest';
import { daysLeftLabel, depositLine, maturityLabel, maturityProgress, rateBpsFrom, rateInputText, rateLabel } from './deposit-terms';

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

  it('turns a stored rate into what the box shows, and back', () => {
    expect(rateInputText(425)).toBe('4,25');
    expect(rateInputText(2000)).toBe('20');
    expect(rateInputText(0)).toBe('');
    expect(rateBpsFrom('4,25')).toBe(425);
    expect(rateBpsFrom('6,37')).toBe(637); // 6.37 × 100 is 636.999… in floating point; the round is what keeps it 637
    expect(rateBpsFrom('12,5')).toBe(1250);
  });
});

describe('where a deposit stands in its term', () => {
  const terms = { maturesOn: '2026-12-01', rateBps: 400 };

  it('dates the term back from the maturity, and counts the days left and what the term pays', () => {
    // 1 Sep to 1 Dec is 91 days; 30 of them gone on 1 Oct. 50 million at 4% for 91 days is 498.630 (floored).
    const p = maturityProgress(terms, { termMonths: 3, termStartedOn: null }, 50_000_000, '2026-10-01');
    expect(p.daysLeft).toBe(61);
    expect(p.fraction).toBeCloseTo(30 / 91);
    expect(p.interestMinor).toBe(498_630);
  });

  it('keeps a stored start that adds up to the maturity, and ignores one that does not', () => {
    expect(maturityProgress(terms, { termMonths: 1, termStartedOn: '2026-11-01' }, 1, '2026-11-01').fraction).toBe(0);
    // A start left from an older term is dated back from the maturity instead.
    expect(maturityProgress(terms, { termMonths: 1, termStartedOn: '2026-01-01' }, 1, '2026-11-01').fraction).toBe(0);
  });

  it('stops the bar at the ends, and pays nothing without a rate', () => {
    const late = maturityProgress({ ...terms, rateBps: 0 }, { termMonths: 3, termStartedOn: null }, 50_000_000, '2027-01-15');
    expect(late).toEqual({ fraction: 1, daysLeft: 0, interestMinor: 0 });
    expect(maturityProgress(terms, { termMonths: 3, termStartedOn: null }, 1, '2026-01-01').fraction).toBe(0);
  });

  it('says the days left in words', () => {
    expect(daysLeftLabel(12)).toBe('12 days left');
    expect(daysLeftLabel(1)).toBe('1 day left');
    expect(daysLeftLabel(0)).toBe('Matured');
  });
});
