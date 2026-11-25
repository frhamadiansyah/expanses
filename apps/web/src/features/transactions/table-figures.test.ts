import { describe, expect, it } from 'vitest';
import { amountFilterOn, amountFilterText, draftFigure, figureText, NO_AMOUNT_FILTER, sumFigures, sumLine, totalFoot, withinAmount } from './table-figures';

const rp = (minor: number) => ({ minor, currency: 'IDR' });

describe('the sum of picked Amount cells', () => {
  it('adds them up and averages them, as a sheet says it', () => {
    // Invented figures: Rp 92.500, Rp 118.000 and Rp 76.000 (IDR has no minor digits here).
    const sum = sumFigures([rp(92_500), rp(118_000), rp(76_000)], 'IDR');
    expect(sum).toEqual({ count: 3, minor: 286_500, currency: 'IDR' });
    expect(sumLine(sum)).toBe(`3 cells · Sum ${figureText(286_500, 'IDR')} · Average ${figureText(95_500, 'IDR')}`);
  });

  it('takes money in away, and says a sum below zero as money in', () => {
    const sum = sumFigures([rp(50_000), rp(-80_000)], 'IDR');
    expect(sum).toEqual({ count: 2, minor: -30_000, currency: 'IDR' });
    expect(figureText(-30_000, 'IDR').startsWith('+')).toBe(true);
    expect(figureText(30_000, 'IDR').startsWith('+')).toBe(false);
  });

  it('rounds the average to the smallest unit', () => {
    const sum = sumFigures([rp(10), rp(10), rp(11)], 'IDR');
    expect(sumLine(sum)).toContain(`Average ${figureText(10, 'IDR')}`);
  });

  it('makes no sum of figures in several currencies, but a grey row (nothing counted) is no other currency', () => {
    expect(sumFigures([rp(10_000), { minor: 500, currency: 'USD' }], 'IDR')).toEqual({ count: 2, mixed: true });
    expect(sumLine({ count: 2, mixed: true })).toBe('2 cells · several currencies, no sum');
    expect(sumFigures([rp(10_000), { minor: 0, currency: 'USD' }], 'IDR')).toEqual({ count: 2, minor: 10_000, currency: 'IDR' });
  });

  it('reads a capture of money in below zero', () => {
    expect(draftFigure({ amountMinor: 25_000, currency: 'IDR', kind: 'income' })).toEqual(rp(-25_000));
    expect(draftFigure({ amountMinor: -25_000, currency: 'IDR', kind: 'income' })).toEqual(rp(-25_000));
    expect(draftFigure({ amountMinor: 25_000, currency: 'IDR', kind: 'expense' })).toEqual(rp(25_000));
  });
});

describe('the total under the rows shown', () => {
  it('says how many rows and what they come to', () => {
    expect(totalFoot(sumFigures([rp(38_000), rp(92_500)], 'IDR'))).toEqual({ shown: '2 shown', total: figureText(130_500, 'IDR') });
  });

  it('has no total for several currencies, and none for no rows but Rp 0', () => {
    expect(totalFoot({ count: 2, mixed: true })).toEqual({ shown: '2 shown', total: null });
    expect(totalFoot(sumFigures([], 'IDR'))).toEqual({ shown: '0 shown', total: figureText(0, 'IDR') });
  });
});

describe('the Amount header’s Over and Under', () => {
  it('is off with nothing typed', () => {
    expect(amountFilterOn(NO_AMOUNT_FILTER)).toBe(false);
    expect(amountFilterOn({ over: '  ', under: '' })).toBe(false);
    expect(withinAmount(1, 'IDR', NO_AMOUNT_FILTER)).toBe(true);
  });

  it('keeps rows over, under, or between, read without their sign', () => {
    const over = { over: '50.000', under: '' };
    expect(amountFilterOn(over)).toBe(true);
    expect(withinAmount(92_500, 'IDR', over)).toBe(true);
    expect(withinAmount(-92_500, 'IDR', over)).toBe(true);
    // Over is more than: the figure itself is not over it.
    expect(withinAmount(50_000, 'IDR', over)).toBe(false);
    const between = { over: '30000', under: '100.000' };
    expect(withinAmount(38_000, 'IDR', between)).toBe(true);
    expect(withinAmount(118_000, 'IDR', between)).toBe(false);
    expect(withinAmount(24_000, 'IDR', between)).toBe(false);
  });

  it('takes no bound from words that are no amount', () => {
    expect(withinAmount(10, 'IDR', { over: 'lots', under: '' })).toBe(true);
  });

  it('says what it holds in the header', () => {
    expect(amountFilterText({ over: '50000', under: '' }, 'IDR')).toBe(`Over ${figureText(50_000, 'IDR')}`);
    expect(amountFilterText({ over: '50000', under: '100000' }, 'IDR')).toBe(`Over ${figureText(50_000, 'IDR')} · Under ${figureText(100_000, 'IDR')}`);
  });
});
