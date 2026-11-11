import { describe, expect, it } from 'vitest';
import { extraFromTyped, typedFromExtra } from './extra-field';

describe('the Extra a month field', () => {
  it('reads what was typed', () => {
    expect(extraFromTyped('500.000', 'IDR')).toBe(500_000);
    expect(extraFromTyped('', 'IDR')).toBe(0);
    expect(() => extraFromTyped('abc', 'IDR')).toThrow('The amount must be a number');
  });
  it('shows what was saved', () => {
    expect(typedFromExtra(500_000, 'IDR')).toBe('500.000');
    expect(typedFromExtra(0, 'IDR')).toBe('');
    expect(typedFromExtra(1_250, 'USD')).toBe('12,50');
  });
});
