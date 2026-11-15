import { describe, expect, it } from 'vitest';
import { capsByNeed, DEFAULT_SPENDING_GUIDE, essentialSplit, gradeSplit, guideLeft, isValidGuide, needsPlan, readGuide } from '../src/index';

// Invented month: Rp 31.400.000 in, rent and groceries essential, dining lifestyle, one category never marked.
const needs = { rent: 'essential', groceries: 'essential', dining: 'lifestyle', hobbies: 'lifestyle' } as const;

describe('essentialSplit', () => {
  it('splits spending by each category’s mark and keeps the rest as debts & savings', () => {
    const split = essentialSplit({
      incomeMinor: 31_400_000,
      spending: [
        { accountId: 'rent', amountBaseMinor: 9_100_000 },
        { accountId: 'groceries', amountBaseMinor: 4_270_000 },
        { accountId: 'dining', amountBaseMinor: 6_830_000 },
      ],
      needs,
    });
    expect(split.essentialMinor).toBe(13_370_000);
    expect(split.lifestyleMinor).toBe(6_830_000);
    expect(split.debtsSavingsMinor).toBe(11_200_000);
    expect(split.overspentMinor).toBe(0);
    expect(split.percents).toEqual({ essential: 42, lifestyle: 22, debtsSavings: 36 });
    expect(split.bar!.essential + split.bar!.lifestyle + split.bar!.debtsSavings).toBeCloseTo(1);
  });

  it('counts an unmarked category as essential', () => {
    const split = essentialSplit({ incomeMinor: 10_000_000, spending: [{ accountId: 'parking', amountBaseMinor: 730_000 }], needs });
    expect(split.essentialMinor).toBe(730_000);
    expect(split.lifestyleMinor).toBe(0);
  });

  it('nets a refund against its own category', () => {
    const split = essentialSplit({
      incomeMinor: 10_000_000,
      spending: [
        { accountId: 'dining', amountBaseMinor: 2_410_000 },
        { accountId: 'hobbies', amountBaseMinor: -390_000 },
      ],
      needs,
    });
    expect(split.lifestyleMinor).toBe(2_020_000);
    expect(split.debtsSavingsMinor).toBe(7_980_000);
  });

  it('rounds the three shares so they add up to exactly 100', () => {
    const split = essentialSplit({
      incomeMinor: 3_000_000,
      spending: [
        { accountId: 'rent', amountBaseMinor: 1_000_000 },
        { accountId: 'dining', amountBaseMinor: 1_000_000 },
      ],
      needs,
    });
    const { essential, lifestyle, debtsSavings } = split.percents!;
    expect(essential + lifestyle + debtsSavings).toBe(100);
  });

  it('lets debts & savings go negative, at 0% of the bar', () => {
    const split = essentialSplit({
      incomeMinor: 8_000_000,
      spending: [
        { accountId: 'rent', amountBaseMinor: 6_500_000 },
        { accountId: 'dining', amountBaseMinor: 3_100_000 },
      ],
      needs,
    });
    expect(split.debtsSavingsMinor).toBe(-1_600_000);
    expect(split.overspentMinor).toBe(1_600_000);
    expect(split.percents).toEqual({ essential: 81, lifestyle: 39, debtsSavings: 0 });
    expect(split.bar!.debtsSavings).toBe(0);
    expect(split.bar!.essential + split.bar!.lifestyle).toBeCloseTo(1);
  });

  it('has amounts only when nothing came in', () => {
    const split = essentialSplit({ incomeMinor: 0, spending: [{ accountId: 'rent', amountBaseMinor: 2_000_000 }], needs });
    expect(split.percents).toBeNull();
    expect(split.bar).toBeNull();
    expect(split.essentialMinor).toBe(2_000_000);
    expect(split.debtsSavingsMinor).toBe(-2_000_000);
  });
});

describe('the guide', () => {
  it('is valid only as three whole percents adding up to 100', () => {
    expect(isValidGuide(DEFAULT_SPENDING_GUIDE)).toBe(true);
    expect(isValidGuide({ essential: 60, lifestyle: 25, debtsSavings: 15 })).toBe(true);
    expect(isValidGuide({ essential: 60, lifestyle: 30, debtsSavings: 20 })).toBe(false);
    expect(isValidGuide({ essential: 50.5, lifestyle: 29.5, debtsSavings: 20 })).toBe(false);
    expect(isValidGuide({ essential: 110, lifestyle: -10, debtsSavings: 0 })).toBe(false);
    expect(guideLeft({ essential: 45, lifestyle: 30, debtsSavings: 15 })).toBe(10);
  });

  it('reads anything broken back as 50 / 30 / 20', () => {
    expect(readGuide(null)).toEqual(DEFAULT_SPENDING_GUIDE);
    expect(readGuide({ essential: 70, lifestyle: 70, debtsSavings: 0 })).toEqual(DEFAULT_SPENDING_GUIDE);
    expect(readGuide({ essential: 55, lifestyle: 25, debtsSavings: 20 })).toEqual({ essential: 55, lifestyle: 25, debtsSavings: 20 });
  });

  it('grades debts & savings against the guide, with the ratios’ watch band', () => {
    const at = (kept: number) => essentialSplit({ incomeMinor: 10_000_000, spending: [{ accountId: 'rent', amountBaseMinor: 10_000_000 - kept }], needs });
    expect(gradeSplit(at(2_000_000), DEFAULT_SPENDING_GUIDE)).toBe('good');
    expect(gradeSplit(at(1_700_000), DEFAULT_SPENDING_GUIDE)).toBe('watch');
    expect(gradeSplit(at(1_500_000), DEFAULT_SPENDING_GUIDE)).toBe('act');
    expect(gradeSplit(at(1_500_000), { essential: 55, lifestyle: 30, debtsSavings: 15 })).toBe('good');
    expect(gradeSplit(at(-500_000), DEFAULT_SPENDING_GUIDE)).toBe('act');
    expect(gradeSplit(essentialSplit({ incomeMinor: 0, spending: [], needs }), DEFAULT_SPENDING_GUIDE)).toBe('unknown');
  });
});

describe('the budget box', () => {
  const lines = [
    { id: 'home', capMinor: 9_500_000, children: [{ id: 'rent', capMinor: 9_000_000, children: [] }] },
    { id: 'fun', capMinor: null, children: [{ id: 'dining', capMinor: 3_000_000, children: [] }, { id: 'hobbies', capMinor: 800_000, children: [] }] },
    { id: 'gadgets', capMinor: null, children: [] },
  ];
  const marks = { home: 'essential', rent: 'essential', fun: 'lifestyle', dining: 'lifestyle', hobbies: 'lifestyle' } as const;

  it('adds up only the outermost caps, by their mark', () => {
    expect(capsByNeed(lines, marks)).toEqual({ essentialMinor: 9_500_000, lifestyleMinor: 3_800_000, any: true });
    expect(capsByNeed([{ id: 'x', capMinor: null, children: [] }], marks).any).toBe(false);
  });

  it('plans debts & savings as the take-home less both plans, and flags what ran over', () => {
    const split = essentialSplit({
      incomeMinor: 12_000_000,
      spending: [
        { accountId: 'rent', amountBaseMinor: 9_800_000 },
        { accountId: 'dining', amountBaseMinor: 1_100_000 },
      ],
      needs: marks,
    });
    const rows = needsPlan(split, capsByNeed(lines, marks), 16_000_000);
    expect(rows.map((row) => [row.key, row.usedMinor, row.plannedMinor, row.warn])).toEqual([
      ['essential', 9_800_000, 9_500_000, true],
      ['lifestyle', 1_100_000, 3_800_000, false],
      ['debtsSavings', 1_100_000, 2_700_000, false],
    ]);
  });

  it('falls back to the income so far when no take-home is planned, and shows amounts only with no caps', () => {
    const split = essentialSplit({ incomeMinor: 5_000_000, spending: [{ accountId: 'rent', amountBaseMinor: 6_000_000 }], needs: marks });
    const planned = needsPlan(split, { essentialMinor: 4_000_000, lifestyleMinor: 0, any: true }, 0);
    expect(planned[2]!.plannedMinor).toBe(1_000_000);
    expect(planned[2]!.warn).toBe(true);
    const bare = needsPlan(split, { essentialMinor: 0, lifestyleMinor: 0, any: false }, 0);
    expect(bare.map((row) => row.plannedMinor)).toEqual([null, null, null]);
  });
});
