import { describe, expect, it } from 'vitest';
import { type CoretaxInputs, coretaxRows, formatMinor } from '../src/index';

const settings = { propertyBasis: 'cost' as const, repeatRows: 'year' as const, kmkRateBps: { USD: 165_000_000 } };
const inputs = (purchases: { occurredOn: string; nativeMinor: number; baseMinor: number }[]): CoretaxInputs => ({
  cash: [], estimated: [], receivables: [], debts: [],
  holdings: [{
    accountId: 'aapl', name: 'Saham AAPL — Interactive Brokers', code: '0303', currency: 'USD', priceMicro: 21_430_000_000,
    byYear: { '2025': { unitsMicro: 10_000_000, costMinor: 28_835_000 } }, fields: {}, purchases,
  }],
});

describe('a foreign holding’s row', () => {
  it('files the base cost it is handed and says how it was reached', () => {
    const [row] = coretaxRows(2025, inputs([{ occurredOn: '2025-03-08', nativeMinor: 182_500, baseMinor: 28_835_000 }]), settings);
    expect(row!.costMinor).toBe(28_835_000);
    expect(row!.note).toBe(`${formatMinor(182_500, 'USD')} at ${formatMinor(15_800, 'IDR')} · 8 Mar 2025`);
  });
  it('counts several purchases rather than inventing one rate for them', () => {
    const [row] = coretaxRows(2025, inputs([
      { occurredOn: '2025-03-08', nativeMinor: 100_000, baseMinor: 15_800_000 },
      { occurredOn: '2025-05-02', nativeMinor: 82_500, baseMinor: 13_035_000 },
    ]), settings);
    expect(row!.note).toBe('2 purchases, each at its own day’s rate');
  });
});
