import { describe, expect, it } from 'vitest';
import { perMonthPreview } from './frequency-form';

describe('the Per month row', () => {
  it('reads the typed figure with parseMajor and converts it once', () => {
    expect(perMonthPreview('500.000', 'weekly', 'IDR')).toBe(2_166_667);
    expect(perMonthPreview('10,00', 'weekly', 'USD')).toBe(4_333);
    expect(perMonthPreview('2.400.000', 'yearly', 'IDR')).toBe(200_000);
  });

  it('shows nothing while the figure cannot be read', () => {
    expect(perMonthPreview('', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('abc', 'weekly', 'IDR')).toBeNull();
    expect(perMonthPreview('10,50', 'weekly', 'IDR')).toBeNull();
  });
});
