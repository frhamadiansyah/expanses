// the shared parts, in the kit's own words (no pocket or holding here)
import { describe, expect, it } from 'vitest';
import { approxLine, groupedFigure, rateLine } from './approx';

const rupiah = (minor: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(minor);

describe('a foreign figure with its converted value beneath', () => {
  it('converts at the held rate, rounding half away from zero', () => {
    expect(approxLine(240_000, 'USD', 'IDR', { USD: 16_250 })).toBe(`≈ ${rupiah(39_000_000)}`);
    // $1.03 at 15.940,37 = 16.418,58 → 16.419; flooring would print 16.418.
    expect(approxLine(103, 'USD', 'IDR', { USD: 15_940.37 })).toBe(`≈ ${rupiah(16_419)}`);
  });

  it('keeps an overdrawn figure’s sign', () => {
    expect(approxLine(-1_000, 'USD', 'IDR', { USD: 16_000 })).toBe(`≈ ${rupiah(-160_000)}`);
  });

  it('says nothing under the base currency, and names a missing rate', () => {
    expect(approxLine(5_400_000, 'IDR', 'IDR', {})).toBeNull();
    expect(approxLine(115_000, 'SGD', 'IDR', {})).toBe('No SGD rate yet');
  });
});

describe('a rate in words', () => {
  it('reads the way the rest of the app does', () => {
    expect(rateLine(16_250, 'USD', 'IDR')).toBe('16.250 IDR per 1 USD');
    expect(rateLine(12_110.5, 'SGD', 'IDR')).toBe('12.110,5 IDR per 1 SGD');
  });
});

describe('a grouped row’s figure', () => {
  it('is the ≈ total, or the missing rates named — never a partial sum', () => {
    expect(groupedFigure({ totalMinor: 58_982_000, missing: [] }, 'IDR')).toEqual({ text: `≈ ${rupiah(58_982_000)}`, complete: true });
    expect(groupedFigure({ totalMinor: null, missing: ['JPY', 'SGD'] }, 'IDR')).toEqual({ text: 'No JPY, SGD rate yet', complete: false });
  });
});
