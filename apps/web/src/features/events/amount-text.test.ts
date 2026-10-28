import { describe, expect, it } from 'vitest';
import { spacedMinor } from './amount-text';

describe('spacedMinor', () => {
  it('puts one plain space between the symbol and the figure', () => {
    expect(spacedMinor(200000, 'IDR')).toBe('Rp 200.000');
    expect(spacedMinor(9500, 'EUR')).toBe('€ 95,00');
    expect(spacedMinor(180050, 'TRY')).toBe('₺ 1.800,50');
  });
});
