import { describe, expect, it } from 'vitest';
import { purchasesForPlastic } from '../src/index';

const plastics = [
  { id: 'p', isPrimary: true },
  { id: 's', isPrimary: false },
];
const lines: { transactionId: string; cardId?: string | null; amountMinor: number }[] = [
  { transactionId: 'a', cardId: 'p', amountMinor: 100 },
  { transactionId: 'b', cardId: 's', amountMinor: 250 },
  { transactionId: 'c', cardId: null, amountMinor: 75 },
  { transactionId: 'd', amountMinor: 30 },
  { transactionId: 'e', cardId: 'gone', amountMinor: 10 },
];
const ids = (rows: { transactionId: string }[]) => rows.map((row) => row.transactionId);

describe('purchasesForPlastic', () => {
  it('gives a plastic its own purchases', () => {
    expect(ids(purchasesForPlastic(lines, plastics, 's'))).toEqual(['b']);
  });

  it('gives the primary its own, those naming no card, and those of a removed card', () => {
    expect(ids(purchasesForPlastic(lines, plastics, 'p'))).toEqual(['a', 'c', 'd', 'e']);
  });

  it('splits every purchase between the plastics exactly once, so the amounts add up to the account', () => {
    const total = (rows: { amountMinor: number }[]) => rows.reduce((sum, row) => sum + row.amountMinor, 0);
    expect(total(purchasesForPlastic(lines, plastics, 'p')) + total(purchasesForPlastic(lines, plastics, 's'))).toBe(total(lines));
  });

  it('keeps everything for an account with one plastic, whatever the purchases name', () => {
    expect(ids(purchasesForPlastic(lines, [plastics[0]!], 'p'))).toEqual(ids(lines));
  });

  it('keeps everything when no plastic is shown yet', () => {
    expect(purchasesForPlastic(lines, plastics, undefined)).toHaveLength(5);
  });

  it('falls back to the first plastic when none is marked primary', () => {
    const odd = [
      { id: 'x', isPrimary: false },
      { id: 'y', isPrimary: false },
    ];
    expect(ids(purchasesForPlastic(lines, odd, 'x'))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(purchasesForPlastic(lines, odd, 'y')).toEqual([]);
  });
});
