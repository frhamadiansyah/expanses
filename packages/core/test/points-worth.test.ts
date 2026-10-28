import { describe, expect, it } from 'vitest';
import { expiryLots, formatValuePerPoint, type PointEntry, parseValuePerPoint, pointsWorth, type Redemption } from '../src';

const best: Redemption = { perPoints: 1000, valueMinor: 75_000, currency: 'IDR' };

describe('pointsWorth', () => {
  it('uses the programme value per point when it is set', () => {
    expect(pointsWorth(18_400, 1_100_000, best, 'IDR')).toEqual({ valueMinor: 2_024_000, currency: 'IDR' });
  });
  it('lets the value set beat a better redemption option', () => {
    expect(pointsWorth(1000, 10_000, { ...best, valueMinor: 900_000 }, 'IDR')).toEqual({ valueMinor: 1000, currency: 'IDR' });
  });
  it('falls back to the best redemption option in its own currency', () => {
    expect(pointsWorth(2500, null, { ...best, currency: 'SGD', valueMinor: 500 }, 'IDR')).toEqual({ valueMinor: 1250, currency: 'SGD' });
  });
  it('is nothing with neither', () => {
    expect(pointsWorth(2500, null, null, 'IDR')).toBeNull();
  });
  it('floors, as it always did', () => {
    expect(pointsWorth(3, 5_000, null, 'IDR')).toEqual({ valueMinor: 1, currency: 'IDR' });
    expect(pointsWorth(1, 5_000, null, 'IDR')).toEqual({ valueMinor: 0, currency: 'IDR' });
  });
});

describe('value per point text', () => {
  it('reads whole and fractional rupiah', () => {
    expect(parseValuePerPoint('110', 'IDR')).toBe(1_100_000);
    expect(parseValuePerPoint('0,5', 'IDR')).toBe(5_000);
    expect(parseValuePerPoint('1.250', 'IDR')).toBe(12_500_000);
    expect(parseValuePerPoint('1.250,75', 'IDR')).toBe(12_507_500);
  });
  it('reads a currency with cents', () => {
    expect(parseValuePerPoint('0.0125', 'USD')).toBe(12_500);
    expect(parseValuePerPoint('0.015', 'USD')).toBe(15_000);
  });
  it('refuses nonsense and over-fine figures', () => {
    expect(() => parseValuePerPoint('abc', 'IDR')).toThrow();
    expect(() => parseValuePerPoint('0,00001', 'IDR')).toThrow();
  });
  it('writes it back with only the decimals it has', () => {
    expect(formatValuePerPoint(1_100_000, 'IDR').replace(/\s/g, ' ')).toBe('Rp 110');
    expect(formatValuePerPoint(5_000, 'IDR').replace(/\s/g, ' ')).toBe('Rp 0,5');
  });
});

const earn = (id: string, quantity: number, expiresOn: string | null): PointEntry => ({ id, kind: 'earn', quantity, occurredOn: '2026-01-01', status: 'posted', batchId: null, expiresOn });
const spend = (id: string, quantity: number, batchId: string): PointEntry => ({ id, kind: 'redeem', quantity, occurredOn: '2026-02-01', status: 'posted', batchId, expiresOn: null });

describe('expiryLots', () => {
  it('lists what is left per date, earliest first, adding batches that die on one day', () => {
    const lots = expiryLots([earn('a', 13_000, '2027-12-31'), earn('b', 3000, '2026-12-31'), earn('c', 1000, '2027-12-31'), earn('d', 2400, '2027-03-31')]);
    expect(lots).toEqual([
      { expiresOn: '2026-12-31', remaining: 3000 },
      { expiresOn: '2027-03-31', remaining: 2400 },
      { expiresOn: '2027-12-31', remaining: 14_000 },
    ]);
  });
  it('counts what spending left, not what was earned, and drops a spent batch', () => {
    const lots = expiryLots([earn('a', 3000, '2026-12-31'), earn('b', 2000, '2027-03-31'), spend('s1', -3000, 'a'), spend('s2', -500, 'b')]);
    expect(lots).toEqual([{ expiresOn: '2027-03-31', remaining: 1500 }]);
  });
  it('leaves out points that never expire', () => {
    expect(expiryLots([earn('a', 100, null)])).toEqual([]);
  });
});

describe('value per point field', () => {
  it('shows the stored figure and groups what is typed', async () => {
    const { valuePerPointText, groupTypedValue } = await import('../src');
    expect(valuePerPointText(1_100_000, 'IDR')).toBe('110');
    expect(valuePerPointText(5_000, 'IDR')).toBe('0,5');
    expect(valuePerPointText(12_500_000, 'IDR')).toBe('1.250');
    expect(valuePerPointText(12_500, 'USD')).toBe('0,0125');
    expect(groupTypedValue('1250', 'IDR')).toBe('1.250');
    expect(groupTypedValue('0,5', 'IDR')).toBe('0,5');
    expect(parseValuePerPoint(valuePerPointText(12_507_500, 'IDR'), 'IDR')).toBe(12_507_500);
  });
});
