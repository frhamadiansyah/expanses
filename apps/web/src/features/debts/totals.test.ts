import type { PersonDebtRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { sideTotal } from './totals';

const card = (personName: string, totalMinor: number, currency: string): PersonDebtRow => ({ personName, direction: 'lent', currency, totalMinor, loans: [], dueState: 'none' });

describe('a side of Lend & borrow in the base currency', () => {
  it('converts each card at its own rate: US$100 and Rp 500.000 are Rp 2.125.000, not Rp 510.000', () => {
    expect(sideTotal([card('Andi', 10_000, 'USD'), card('Budi', 500_000, 'IDR')], 'IDR', { USD: 16_250 })).toEqual({ totalMinor: 2_125_000, missing: [] });
  });

  it('gives no figure when a rate is missing, and names it — not the rupiah alone', () => {
    expect(sideTotal([card('Andi', 10_000, 'USD'), card('Budi', 500_000, 'IDR')], 'IDR', {})).toEqual({ totalMinor: null, missing: ['USD'] });
  });

  it('adds base-currency cards as they are', () => {
    expect(sideTotal([card('Budi', 500_000, 'IDR'), card('Cici', 250_000, 'IDR')], 'IDR', {})).toEqual({ totalMinor: 750_000, missing: [] });
  });
});
