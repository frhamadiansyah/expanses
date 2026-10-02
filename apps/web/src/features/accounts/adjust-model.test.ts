import { describe, expect, it } from 'vitest';
import { adjustChoices, adjustDifference, adjustTitle, defaultAdjustAs, differenceWords } from './adjust-model';

describe('adjusting a balance', () => {
  it('counts cash, and adjusts anything else', () => {
    expect(adjustTitle('cash')).toBe('Count cash');
    expect(adjustTitle('ewallet')).toBe('Adjust balance');
    expect(defaultAdjustAs('cash')).toBe('cashflow');
    expect(defaultAdjustAs('bank')).toBe('correction');
  });

  it('reads the difference from what was typed, in the account currency', () => {
    expect(adjustDifference('887.500', 'IDR', 932_500)).toBe(-45_000);
    expect(adjustDifference('', 'IDR', 932_500)).toBeNull();
    expect(adjustDifference('abc', 'IDR', 932_500)).toBeNull();
    expect(adjustDifference('10.50', 'USD', 1_000)).toBe(50);
  });

  it('says which way the figure moved and words the choices to match', () => {
    expect(differenceWords(-45_000, 'IDR').replace(/\s/g, ' ')).toBe('Rp 45.000 less');
    expect(differenceWords(2_000, 'IDR')).toMatch(/2\.000 more$/);
    expect(adjustChoices(-1).map((c) => c.label)).toEqual(['Spending I didn’t record', 'Just a correction']);
    expect(adjustChoices(1)[0]!.detail).toBe('Counts in Cashflow, as “Unrecorded income”');
    expect(adjustChoices(1)[1]!.detail).toBe('Fixes the balance; not counted as income');
  });
});
