import { capsByNeed, DEFAULT_SPENDING_GUIDE, essentialSplit, needsPlan } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { draftOf, guideText, needsBoxRows, readDraft, splitCard, splitView } from './split-view';

// Invented month: Rp 24.800.000 in.
const needs = { rent: 'essential', dining: 'lifestyle' } as const;
const month = (income: number, rent: number, dining: number) =>
  essentialSplit({
    incomeMinor: income,
    spending: [
      { accountId: 'rent', amountBaseMinor: rent },
      { accountId: 'dining', amountBaseMinor: dining },
    ],
    needs,
  });

describe('Cashflow Income page 2', () => {
  it('lists the three parts with their shares, Essential and Lifestyle filtering the list', () => {
    const view = splitView(month(24_800_000, 12_900_000, 7_440_000), DEFAULT_SPENDING_GUIDE);
    expect(view.rows.map((row) => [row.label, row.percent, row.amountMinor, row.filters])).toEqual([
      ['Essential', '52%', 12_900_000, true],
      ['Lifestyle', '30%', 7_440_000, true],
      ['Debts & savings', '18%', 4_460_000, false],
    ]);
    expect(view.marks).toEqual([50, 80]);
    expect(view.guide).toBe('50 / 30 / 20');
    expect(view.overspentMinor).toBe(0);
  });

  it('puts the marks where a changed guide puts them', () => {
    expect(splitView(month(1_000_000, 0, 0), { essential: 60, lifestyle: 25, debtsSavings: 15 }).marks).toEqual([60, 85]);
  });

  it('shows debts & savings below nought in the warn colour, with the overspend named and no share of the bar', () => {
    const view = splitView(month(9_000_000, 7_100_000, 2_650_000), DEFAULT_SPENDING_GUIDE);
    const kept = view.rows[2]!;
    expect(kept.amountMinor).toBe(-750_000);
    expect(kept.warn).toBe(true);
    expect(kept.percent).toBe('0%');
    expect(view.bar!.find((part) => part.key === 'debtsSavings')!.width).toBe(0);
    expect(view.overspentMinor).toBe(750_000);
  });

  it('shows amounts only, with no bar, when nothing came in', () => {
    const view = splitView(month(0, 1_200_000, 0), DEFAULT_SPENDING_GUIDE);
    expect(view.bar).toBeNull();
    expect(view.rows.every((row) => row.percent === null)).toBe(true);
  });
});

describe('the Financial health card', () => {
  it('reads three shares, the guide, and on track once debts & savings reaches it', () => {
    const card = splitCard(month(20_000_000, 11_000_000, 5_000_000), DEFAULT_SPENDING_GUIDE);
    expect(card.value).toBe('55 · 25 · 20');
    expect(card.benchmark).toBe('50 · 30 · 20');
    expect(card.statusLabel).toBe('On track');
  });

  it('follows a changed guide for its grade and its guide line', () => {
    const split = month(20_000_000, 12_000_000, 5_000_000);
    expect(splitCard(split, DEFAULT_SPENDING_GUIDE).statusLabel).toBe('Act now');
    const card = splitCard(split, { essential: 60, lifestyle: 25, debtsSavings: 15 });
    expect(card.statusLabel).toBe('On track');
    expect(card.benchmark).toBe('60 · 25 · 15');
  });

  it('says there is not enough data with no income or while it is read', () => {
    expect(splitCard(undefined, DEFAULT_SPENDING_GUIDE)).toMatchObject({ value: '—', statusLabel: 'Not enough data' });
    expect(splitCard(month(0, 500_000, 0), DEFAULT_SPENDING_GUIDE)).toMatchObject({ value: '—', statusLabel: 'Not enough data' });
  });
});

describe('the Budget box', () => {
  it('reads used of planned, warn colour past the plan', () => {
    const lines = [
      { id: 'rent', capMinor: 12_000_000, children: [] },
      { id: 'dining', capMinor: 8_000_000, children: [] },
    ];
    const rows = needsBoxRows(needsPlan(month(22_000_000, 12_900_000, 6_000_000), capsByNeed(lines, needs), 25_000_000));
    expect(rows.map((row) => [row.label, row.usedMinor, row.plannedMinor, row.warn])).toEqual([
      ['Essential', 12_900_000, 12_000_000, true],
      ['Lifestyle', 6_000_000, 8_000_000, false],
      ['Debts & savings', 3_100_000, 5_000_000, false],
    ]);
    expect(rows[0]!.colour).toBe('var(--ph-warn)');
    expect(rows[1]!.fill).toBe(75);
  });
});

describe('the Guide sheet', () => {
  it('saves only three whole percents adding up to 100, and says what is left', () => {
    expect(readDraft(draftOf(DEFAULT_SPENDING_GUIDE))).toEqual({ guide: DEFAULT_SPENDING_GUIDE, footer: 'Adds up to 100%.' });
    expect(readDraft({ essential: '50', lifestyle: '30', debtsSavings: '10' })).toEqual({ guide: null, footer: '10% left to place.' });
    expect(readDraft({ essential: '60', lifestyle: '30', debtsSavings: '20' })).toEqual({ guide: null, footer: '10% over 100.' });
    expect(readDraft({ essential: '', lifestyle: '30', debtsSavings: '20' }).guide).toBeNull();
    expect(readDraft({ essential: '55', lifestyle: '25', debtsSavings: '20' }).guide).toEqual({ essential: 55, lifestyle: 25, debtsSavings: 20 });
  });

  it('writes a guide the two ways it is shown', () => {
    expect(guideText(DEFAULT_SPENDING_GUIDE)).toBe('50 / 30 / 20');
    expect(guideText(DEFAULT_SPENDING_GUIDE, ' · ')).toBe('50 · 30 · 20');
  });
});
