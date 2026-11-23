import { describe, expect, it } from 'vitest';
import { tileMoney } from './desk';

describe('tileMoney', () => {
  it('reads rupiah in millions and billions with at most two decimals', () => {
    expect(tileMoney(13_981_934, 'IDR')).toBe('Rp 13,98 jt');
    expect(tileMoney(41_500_000, 'IDR')).toBe('Rp 41,5 jt');
    expect(tileMoney(1_875_136_135, 'IDR')).toBe('Rp 1,88 M');
    expect(tileMoney(-2_000_000, 'IDR')).toBe('−Rp 2 jt');
  });
  it('keeps a figure under a million whole, and another currency in its own units', () => {
    expect(tileMoney(450_000, 'IDR')).toMatch(/^Rp\s?450\.000$/);
    expect(tileMoney(11_970, 'USD')).toMatch(/120/);
  });
});
