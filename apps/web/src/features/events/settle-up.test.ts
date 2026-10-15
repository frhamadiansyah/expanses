import { convertMinor, minorToMajorString } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { settleFigure, suggestedFigure } from './settle-up';

/* Invented rates: 1 TRY = 470 IDR (base IDR), so `from` is 470 and `to` is 1. */
const rate = { from: 470, to: 1 };

describe('a settle-up into an account of another currency (R5)', () => {
  it('works the figure out from the amount as it stands at save, not as it stood at the pick', () => {
    // Picked at ₺2.900, then cut to a part payment of ₺1.000 before saving.
    expect(settleFigure({ amountMinor: 100_000, eventCurrency: 'TRY', accountCurrency: 'IDR', typed: null, rate })).toBe(convertMinor(100_000, 'TRY', 'IDR', 470));
    expect(settleFigure({ amountMinor: 100_000, eventCurrency: 'TRY', accountCurrency: 'IDR', typed: null, rate })).not.toBe(convertMinor(290_000, 'TRY', 'IDR', 470));
  });

  it('keeps a figure typed by hand', () => {
    expect(settleFigure({ amountMinor: 100_000, eventCurrency: 'TRY', accountCurrency: 'IDR', typed: '471000', rate })).toBe(471_000);
  });

  it('says so plainly when there is no rate and nothing was typed', () => {
    expect(() => settleFigure({ amountMinor: 100_000, eventCurrency: 'TRY', accountCurrency: 'IDR', typed: null, rate: null })).toThrow('No IDR rate for today yet: type the figure in IDR');
  });

  it('refuses a typed figure of nought', () => {
    expect(() => settleFigure({ amountMinor: 100_000, eventCurrency: 'TRY', accountCurrency: 'IDR', typed: '0', rate })).toThrow('Enter what moved in IDR');
  });

  it('suggests the figure for the amount as typed, and nothing for an amount that is not one', () => {
    expect(suggestedFigure('1000', 'TRY', 'IDR', rate)).toBe(minorToMajorString(convertMinor(100_000, 'TRY', 'IDR', 470), 'IDR'));
    expect(suggestedFigure('', 'TRY', 'IDR', rate)).toBe('');
    expect(suggestedFigure('1000', 'TRY', 'IDR', null)).toBe('');
  });
});
