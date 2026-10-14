import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findAmounts, WORDS } from '../src/index';

/** Thousands marks, the way each money is written by hand. */
const grouped = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const run = { numRuns: 300, seed: 20260930 } as const;

describe('findAmounts, over every figure it can be handed', () => {
  it('reads a printed rupiah figure as itself, in whole rupiah (IDR keeps no minor digits), with or without the cents a person writes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000_000 }), fc.boolean(), (rupiah, cents) => {
        const text = `Rp${grouped(String(rupiah))}${cents ? ',00' : ''}`;
        const [found] = findAmounts(text, WORDS);
        expect(found?.minor).toBe(rupiah);
        expect(found?.currency).toBe('IDR');
      }),
      run,
    );
  });

  it('reads a printed dollar figure as cents, whatever the cents come to', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (cents) => {
        const dollars = grouped(String(Math.floor(cents / 100))).replace(/\./g, ',');
        const rest = String(cents % 100).padStart(2, '0');
        const [found] = findAmounts(`$${dollars}.${rest}`, WORDS);
        expect(found?.minor).toBe(cents);
        expect(found?.currency).toBe('USD');
      }),
      run,
    );
  });

  it('keeps the exact rupiah figure in hundredths when the cents are not zero, and the minor stays the nearest rupiah', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), fc.integer({ min: 0, max: 99 }), (rupiah, cents) => {
        const [found] = findAmounts(`Rp${grouped(String(rupiah))},${String(cents).padStart(2, '0')}`, WORDS);
        const hundredths = rupiah * 100 + cents;
        expect(found?.exactHundredths).toBe(cents === 0 ? undefined : hundredths);
        expect(found?.minor).toBe(cents >= 50 ? rupiah + 1 : rupiah);
      }),
      run,
    );
  });
});
