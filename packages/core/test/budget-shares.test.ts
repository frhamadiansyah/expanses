import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bpOf, formatBp, parsePercentBp, resolveCaps, ShareError, shareOfMinor } from '../src/index';

describe('parsePercentBp and formatBp', () => {
  it('reads a percentage typed with a comma or a dot, up to two decimals', () => {
    expect(parsePercentBp('30')).toBe(3000);
    expect(parsePercentBp('15,5')).toBe(1550);
    expect(parsePercentBp('12.25%')).toBe(1225);
    expect(parsePercentBp(' 100 ')).toBe(10000);
  });

  it('refuses nothing, more than 100, three decimals and words', () => {
    for (const text of ['', '0', '0,00', '100,01', '12,345', 'abc', '-5']) expect(() => parsePercentBp(text)).toThrow(ShareError);
  });

  it('writes a share back as it would be typed', () => {
    expect(formatBp(3000)).toBe('30');
    expect(formatBp(1550)).toBe('15,5');
    expect(formatBp(1225)).toBe('12,25');
    expect(formatBp(5)).toBe('0,05');
  });
});

describe('shareOfMinor', () => {
  it('takes the share to the nearest whole unit', () => {
    expect(shareOfMinor(12_000_000, 1550, 'IDR')).toBe(1_860_000);
    expect(shareOfMinor(10_001, 3333, 'IDR')).toBe(3_333);
    expect(shareOfMinor(123_456, 5000, 'USD')).toBe(61_700);
  });

  it('never goes above its basis, even rounded', () => {
    expect(shareOfMinor(1_050, 10000, 'USD')).toBe(1_050);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e13 }), fc.integer({ min: 1, max: 10000 }), fc.constantFrom('IDR', 'USD', 'JPY'), (base, bp, currency) => {
        const share = shareOfMinor(base, bp, currency);
        return share >= 0 && share <= base;
      }),
    );
  });
});

describe('bpOf', () => {
  it('is the share an amount is of a basis, or null without one', () => {
    expect(bpOf(1_860_000, 12_000_000)).toBe(1550);
    expect(bpOf(20_000_000, 12_000_000)).toBe(10000);
    expect(bpOf(1, 12_000_000)).toBe(1);
    expect(bpOf(1_000, 0)).toBeNull();
  });
});

describe('resolveCaps', () => {
  const parents: Record<string, string | null> = { food: null, groceries: 'food', snacks: 'food', fun: null };
  const parentOf = (id: string) => parents[id] ?? null;

  it('resolves a % of take-home, and a % of a parent from the parent’s own figure', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'food', planMinor: 0, overrideMinor: null, share: { basis: 'take-home', bp: 3000 } },
        { categoryId: 'groceries', planMinor: 0, overrideMinor: null, share: { basis: 'parent', bp: 4000 } },
        { categoryId: 'fun', planMinor: 500_000, overrideMinor: null, share: null },
      ],
      parentOf,
      10_000_000,
      'IDR',
    );
    expect(caps.get('food')).toEqual({ planMinor: 3_000_000, amountMinor: 3_000_000 });
    expect(caps.get('groceries')).toEqual({ planMinor: 1_200_000, amountMinor: 1_200_000 });
    expect(caps.get('fun')).toEqual({ planMinor: 500_000, amountMinor: 500_000 });
  });

  it('follows the parent’s figure for this month alone, and lets a child’s own month figure win', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'food', planMinor: 2_000_000, overrideMinor: 5_000_000, share: null },
        { categoryId: 'groceries', planMinor: 0, overrideMinor: null, share: { basis: 'parent', bp: 5000 } },
        { categoryId: 'snacks', planMinor: 0, overrideMinor: 90_000, share: { basis: 'parent', bp: 1000 } },
      ],
      parentOf,
      10_000_000,
      'IDR',
    );
    expect(caps.get('groceries')!.amountMinor).toBe(2_500_000);
    expect(caps.get('snacks')).toEqual({ planMinor: 500_000, amountMinor: 90_000 });
  });

  it('falls back to the stored figure when the parent has no cap, and gives nothing for a take-home of nothing', () => {
    const caps = resolveCaps(
      [
        { categoryId: 'groceries', planMinor: 700_000, overrideMinor: null, share: { basis: 'parent', bp: 4000 } },
        { categoryId: 'fun', planMinor: 400_000, overrideMinor: null, share: { basis: 'take-home', bp: 500 } },
      ],
      parentOf,
      0,
      'IDR',
    );
    expect(caps.get('groceries')!.amountMinor).toBe(700_000);
    expect(caps.get('fun')!.amountMinor).toBe(0);
  });
});
