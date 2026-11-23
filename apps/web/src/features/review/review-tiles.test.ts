import { describe, expect, it } from 'vitest';
import { missingTile, readyTotal } from './review-tiles';

const state = (over: Partial<{ needsAccount: boolean; needsCategory: boolean; checkAmount: boolean }> = {}) => ({
  needsAccount: false,
  needsCategory: false,
  checkAmount: false,
  ...over,
});

// Invented captures.
describe('missingTile', () => {
  it('counts each capture once, and names what is missing with how many', () => {
    const tile = missingTile([state(), state({ needsAccount: true, needsCategory: true }), state({ needsCategory: true }), state({ checkAmount: true })]);
    expect(tile).toEqual({
      count: 3,
      parts: [
        { key: 'account', count: 1 },
        { key: 'category', count: 2 },
        { key: 'amount', count: 1 },
      ],
    });
  });

  it('is nought with nothing missing', () => {
    expect(missingTile([state(), state()])).toEqual({ count: 0, parts: [] });
  });
});

describe('readyTotal', () => {
  it('adds the ready figures as the table shows them, money in or out', () => {
    expect(
      readyTotal([
        { amountMinor: 48_000, currency: 'IDR' },
        { amountMinor: 15_000, currency: 'IDR' },
        { amountMinor: -250_000, currency: 'IDR' },
      ]),
    ).toEqual({ minor: 313_000, currency: 'IDR' });
  });

  it('has no figure with none ready, or with several currencies', () => {
    expect(readyTotal([])).toBeNull();
    expect(
      readyTotal([
        { amountMinor: 48_000, currency: 'IDR' },
        { amountMinor: 1_250, currency: 'SGD' },
      ]),
    ).toBeNull();
  });
});
