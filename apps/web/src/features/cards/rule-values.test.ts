import { describe, expect, it } from 'vitest';
import { parseRulePoints } from './rule-values';

describe('parseRulePoints', () => {
  it('accepts whole numbers and one decimal written with a comma or a dot', () => {
    expect(parseRulePoints('3')).toBe(3);
    expect(parseRulePoints('7,5')).toBe(7.5);
    expect(parseRulePoints(' 2.5 ')).toBe(2.5);
    expect(parseRulePoints('0')).toBe(0);
    expect(parseRulePoints('')).toBeNull();
  });

  it('rejects negatives, more than one decimal, and text', () => {
    for (const value of ['-1', '7,25', '1.000', 'abc', '1,5,0']) expect(() => parseRulePoints(value), value).toThrow();
  });
});
