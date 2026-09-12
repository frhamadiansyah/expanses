import { describe, expect, it } from 'vitest';
import { assetValueAt, type AssetValueInput, isStaleValue, positionAfter, type TradeRecord } from '../src/index';

const buy = (occurredOn: string, units: number, grossMinor: number): TradeRecord => ({
  id: `t-${occurredOn}`,
  accountId: 'gold',
  kind: 'buy',
  occurredOn,
  createdAt: `${occurredOn}T00:00:00Z`,
  unitsMicro: units * 1_000_000,
  grossMinor,
  feeMinor: 0,
  taxMinor: 0,
});

const goldTrades = [buy('2024-02-03', 10, 13_100_000), buy('2026-03-09', 5, 9_300_000)];
const market = (date: string): AssetValueInput => ({
  accountId: 'gold',
  mode: 'market',
  currency: 'IDR',
  ledgerBalanceMinor: positionAfter(goldTrades, date).costMinor,
  position: positionAfter(goldTrades, date),
  prices: [
    { onDate: '2026-02-01', priceMicro: 1_688_000_000_000 },
    { onDate: '2026-08-31', priceMicro: 1_815_000_000_000 },
    { onDate: '2026-09-11', priceMicro: 1_842_000_000_000 },
  ],
});

const house: AssetValueInput = {
  accountId: 'house',
  mode: 'snapshot',
  currency: 'IDR',
  ledgerBalanceMinor: 1_150_000_000,
  valuations: [
    { asOf: '2026-01-15', valueMinor: 1_420_000_000, basis: 'appraisal' },
    { asOf: '2026-05-20', valueMinor: 905_000_000, basis: 'njop' },
  ],
};

describe('assetValueAt', () => {
  it('returns the ledger balance in derived mode', () => {
    const value = assetValueAt({ accountId: 'bca', mode: 'derived', currency: 'IDR', ledgerBalanceMinor: 48_250_000 }, '2026-09-12');
    expect(value).toMatchObject({ valueMinor: 48_250_000, costMinor: 48_250_000, source: 'ledger' });
  });

  it('multiplies units held on the date by the latest price on or before it', () => {
    const value = assetValueAt(market('2026-09-12'), '2026-09-12');
    expect(value.valueMinor).toBe(27_630_000);
    expect(value.costMinor).toBe(22_400_000);
    expect(value.source).toBe('price');
    expect(value.asOf).toBe('2026-09-11');
  });

  it('ignores a price dated after the day asked for', () => {
    const value = assetValueAt(market('2026-09-01'), '2026-09-01');
    expect(value.asOf).toBe('2026-08-31');
    expect(value.valueMinor).toBe(27_225_000);
  });

  it('uses units held on that date, not today', () => {
    const value = assetValueAt(market('2026-02-28'), '2026-02-28');
    expect(value.valueMinor).toBe(16_880_000);
    expect(value.costMinor).toBe(13_100_000);
    expect(value.asOf).toBe('2026-02-01');
  });

  it('falls back to cost when a holding has no price yet', () => {
    const value = assetValueAt({ ...market('2026-09-12'), prices: [] }, '2026-09-12');
    expect(value).toMatchObject({ valueMinor: 22_400_000, costMinor: 22_400_000, source: 'cost', asOf: null });
  });

  it('returns the latest estimate in snapshot mode', () => {
    const value = assetValueAt(house, '2026-09-12');
    expect(value).toMatchObject({ valueMinor: 1_420_000_000, costMinor: 1_150_000_000, source: 'valuation', asOf: '2026-01-15' });
  });

  it('ignores an NJOP row even when it is the newest', () => {
    const value = assetValueAt({ ...house, valuations: [{ asOf: '2026-08-01', valueMinor: 905_000_000, basis: 'njop' }] }, '2026-09-12');
    expect(value).toMatchObject({ valueMinor: 1_150_000_000, source: 'cost' });
  });

  it('falls back to cost when nothing has been estimated', () => {
    const value = assetValueAt({ ...house, valuations: [] }, '2026-09-12');
    expect(value).toMatchObject({ valueMinor: 1_150_000_000, costMinor: 1_150_000_000, source: 'cost' });
  });
});

describe('isStaleValue', () => {
  it('marks a price older than 30 days', () => {
    expect(isStaleValue({ accountId: 'gold', valueMinor: 1, costMinor: 1, source: 'price', asOf: '2026-08-12' }, '2026-09-12')).toBe(true);
    expect(isStaleValue({ accountId: 'gold', valueMinor: 1, costMinor: 1, source: 'price', asOf: '2026-08-20' }, '2026-09-12')).toBe(false);
  });

  it('marks an estimate older than a year', () => {
    expect(isStaleValue({ accountId: 'house', valueMinor: 1, costMinor: 1, source: 'valuation', asOf: '2025-09-10' }, '2026-09-12')).toBe(true);
    expect(isStaleValue({ accountId: 'house', valueMinor: 1, costMinor: 1, source: 'valuation', asOf: '2025-10-01' }, '2026-09-12')).toBe(false);
  });

  it('marks a holding that has no price at all', () => {
    expect(isStaleValue({ accountId: 'gold', valueMinor: 1, costMinor: 1, source: 'cost', asOf: null }, '2026-09-12')).toBe(true);
  });

  it('never marks a ledger balance', () => {
    expect(isStaleValue({ accountId: 'bca', valueMinor: 1, costMinor: 1, source: 'ledger', asOf: null }, '2026-09-12')).toBe(false);
  });
});
