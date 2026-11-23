import { balanceSheet, type SheetRow } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { assetSide, debtsAgainstAssets, debtSide, monthChange, monthTicks, peekOrder, sheetLine, stripLayout, treemapOf, treemapStrip, wholeShares, yearChange } from './networth-desk-model';
import type { RowKind } from './sheet-drawers';

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe('wholeShares', () => {
  it('adds up to exactly 100, the largest remainders taking the rounding', () => {
    // 1/3 each: 33 + 33 + 34, never 33 + 33 + 33.
    expect(sum(wholeShares([1, 1, 1]))).toBe(100);
    expect(wholeShares([590, 157, 183, 64, 6])).toEqual([59, 16, 18, 6, 1]);
    expect(sum(wholeShares([590, 157, 183, 64, 6]))).toBe(100);
  });

  it('never prints 0% for a part that is held: a sliver reads 1%, taken from the largest', () => {
    const shares = wholeShares([1_000_000_000, 1_000, 2_000]);
    expect(shares).toEqual([98, 1, 1]);
    expect(sum(shares)).toBe(100);
  });

  it('gives nothing a share: parts at or below nought read 0 and the rest still add up to 100', () => {
    expect(wholeShares([50, -20, 50])).toEqual([50, 0, 50]);
    expect(wholeShares([0, 0])).toEqual([0, 0]);
    expect(wholeShares([])).toEqual([]);
  });
});

describe('stripLayout', () => {
  it('lays the spans end to end and they add up to 100', () => {
    const spans = stripLayout([60, 25, 15]);
    close(sum(spans.map((span) => span.size)), 100);
    close(spans[0]!.start, 0);
    close(spans[1]!.start, spans[0]!.size);
    close(spans[2]!.start, spans[0]!.size + spans[1]!.size);
    close(spans[0]!.size, 60);
  });

  it('keeps a tiny slice visible at the floor and the large ones in proportion to each other', () => {
    const spans = stripLayout([700, 299, 1], 1);
    close(sum(spans.map((span) => span.size)), 100);
    close(spans[2]!.size, 1);
    // 700 : 299 kept exactly, in the 99 left.
    close(spans[0]!.size / spans[1]!.size, 700 / 299);
  });

  it('lifts several slivers at once', () => {
    const spans = stripLayout([1000, 1, 1, 1], 2);
    expect(spans.slice(1).every((span) => Math.abs(span.size - 2) < 1e-9)).toBe(true);
    close(spans[0]!.size, 94);
  });

  it('draws nothing for a value at or below nought, and nothing at all for no total', () => {
    const spans = stripLayout([10, 0, 10]);
    expect(spans[1]!.size).toBe(0);
    close(sum(spans.map((span) => span.size)), 100);
    expect(stripLayout([0, 0]).every((span) => span.size === 0)).toBe(true);
  });
});

describe('treemapStrip', () => {
  const input = [
    { key: 'liquid', label: 'Cash & equivalents', minor: 438_762_000 },
    {
      key: 'invest',
      label: 'Investments',
      minor: 456_800_000,
      parts: [
        { key: 'fund', label: 'Mutual funds', minor: 120_000_000 },
        { key: 'stock', label: 'Listed shares', minor: 36_800_000 },
        { key: 'bond', label: 'Government bonds', minor: 300_000_000 },
      ],
    },
    { key: 'immovable', label: 'Immovable property', minor: 1_650_000_000 },
    { key: 'receivable', label: 'Receivables', minor: 1_914_559 },
  ];

  it('orders the boxes largest first, their widths add up to 100% and so do their shares', () => {
    const boxes = treemapStrip(input);
    expect(boxes.map((box) => box.key)).toEqual(['immovable', 'invest', 'liquid', 'receivable']);
    close(sum(boxes.map((box) => box.width)), 100);
    expect(sum(boxes.map((box) => box.share))).toBe(100);
    close(boxes[3]!.left + boxes[3]!.width, 100);
  });

  it('keeps a tiny slice on the strip, at least a sliver wide and 1%', () => {
    const tiny = treemapStrip(input).find((box) => box.key === 'receivable')!;
    expect(tiny.width).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(tiny.share).toBe(1);
  });

  it('splits Investments inside its box by holding type: heights add up to 100%, shares of the box to 100', () => {
    const invest = treemapStrip(input).find((box) => box.key === 'invest')!;
    expect(invest.parts.map((part) => part.key)).toEqual(['bond', 'fund', 'stock']);
    close(sum(invest.parts.map((part) => part.height)), 100);
    expect(sum(invest.parts.map((part) => part.share))).toBe(100);
    expect(sum(invest.parts.map((part) => part.minor))).toBe(invest.minor);
    // A box of one kind is not split.
    expect(treemapStrip([{ key: 'x', label: 'X', minor: 5, parts: [{ key: 'a', label: 'A', minor: 5 }] }])[0]!.parts).toEqual([]);
  });

  it('leaves a kind below nought off the strip and divides what is held', () => {
    const boxes = treemapStrip([
      { key: 'liquid', label: 'Cash', minor: -5 },
      { key: 'invest', label: 'Investments', minor: 10 },
    ]);
    expect(boxes.map((box) => box.key)).toEqual(['invest']);
    expect(boxes[0]!.share).toBe(100);
    close(boxes[0]!.width, 100);
  });
});

describe('assetSide and debtSide', () => {
  const kinds: Record<string, RowKind> = {
    bca: { key: 'bank', label: 'Current account' },
    jenius: { key: 'bank', label: 'Current account' },
    bbca: { key: 'stock', label: 'Listed shares' },
    rdpt: { key: 'fund', label: 'Mutual funds' },
    sbr: { key: 'bond', label: 'Government bonds' },
    house: { key: 'house', label: 'House' },
  };
  const sheet = balanceSheet(
    [
      { accountId: 'bca', name: 'BCA', planGroup: 'liquid', valueMinor: 306_000_000, subtype: 'bank' },
      { accountId: 'jenius', name: 'Jenius', planGroup: 'liquid', valueMinor: 132_762_000, subtype: 'bank' },
      { accountId: 'bbca', name: 'BBCA', planGroup: 'invest', valueMinor: 36_800_000, subtype: 'investment' },
      { accountId: 'rdpt', name: 'Fund', planGroup: 'invest', valueMinor: 120_000_000, subtype: 'investment' },
      { accountId: 'sbr', name: 'SBR013', planGroup: 'invest', valueMinor: 300_000_000, subtype: 'investment' },
      { accountId: 'house', name: 'Home', planGroup: 'invest', valueMinor: 1_650_000_000, subtype: 'property' },
    ],
    [
      { accountId: 'kpr', name: 'KPR', subtype: 'loan', balanceMinor: 712_500_000, dueWithinYearMinor: 40_000_000, note: null, item: 'home_mortgage', icon: 'home' },
      { accountId: 'visa', name: 'Visa', subtype: 'credit_card', balanceMinor: 23_650_000, dueWithinYearMinor: 23_650_000, note: null, icon: 'card' },
      { accountId: 'mc', name: 'Mastercard', subtype: 'credit_card', balanceMinor: 1_350_000, dueWithinYearMinor: 1_350_000, note: null, icon: 'card' },
    ],
  );
  const rowKind = (_section: string, row: SheetRow) => kinds[row.accountId]!;
  const debtKind = (row: SheetRow): RowKind => (row.accountId === 'kpr' ? { key: 'home_mortgage', label: 'Home mortgage' } : { key: 'credit_card', label: 'Credit card' });
  const assets = assetSide(sheet.assetGroups, rowKind);
  const debts = debtSide(sheet.debts, debtKind);

  it('each kind is the sum of its rows, and the kinds add up to the side', () => {
    for (const kind of [...assets.kinds, ...debts.kinds]) expect(kind.totalMinor).toBe(sum(kind.items.map((item) => item.minor!)));
    expect(sum(assets.kinds.map((kind) => kind.totalMinor!))).toBe(assets.totalMinor);
    expect(sum(debts.kinds.map((kind) => kind.totalMinor!))).toBe(debts.totalMinor);
  });

  it('Total assets − Total debts is the sheet’s net worth, cards owed in full', () => {
    expect(assets.totalMinor).toBe(sheet.assetsTotalMinor);
    expect(debts.totalMinor).toBe(sheet.liabilitiesTotalMinor);
    expect(assets.totalMinor - debts.totalMinor).toBe(sheet.netWorthMinor);
    expect(debts.kinds.find((kind) => kind.key === 'credit_card')!.totalMinor).toBe(25_000_000);
  });

  it('folds the debts by kind, each debt once, and their shares add up to 100', () => {
    expect(debts.kinds.map((kind) => [kind.key, kind.items.length])).toEqual([
      ['home_mortgage', 1],
      ['credit_card', 2],
    ]);
    expect(sum(debts.kinds.map((kind) => kind.share))).toBe(100);
    expect(sum(assets.kinds.map((kind) => kind.share))).toBe(100);
  });

  it('gives Investments its parts by holding type, and no other section', () => {
    const invest = assets.kinds.find((kind) => kind.key === 'invest')!;
    expect(invest.parts.map((part) => part.key).sort()).toEqual(['bond', 'fund', 'stock']);
    expect(sum(invest.parts.map((part) => part.minor))).toBe(invest.totalMinor);
    expect(assets.kinds.find((kind) => kind.key === 'liquid')!.parts).toEqual([]);
    const boxes = treemapOf(assets);
    expect(boxes.find((box) => box.key === 'invest')!.parts).toHaveLength(3);
  });

  it('leaves a kind blank (and off the treemap) while a row in it has no rate', () => {
    const side = assetSide(sheet.assetGroups, rowKind, new Set(['jenius']));
    const cash = side.kinds.find((kind) => kind.key === 'liquid')!;
    expect(cash.totalMinor).toBeNull();
    expect(cash.items.find((item) => item.accountId === 'jenius')!.minor).toBeNull();
    expect(treemapOf(side).map((box) => box.key)).not.toContain('liquid');
  });

  it('steps through kinds and the rows of open kinds, assets then debts', () => {
    expect(peekOrder(assets, debts, new Set(['asset-kind:invest', 'debt-kind:credit_card']))).toEqual([
      'asset-kind:liquid',
      'asset:bca',
      'asset:jenius',
      'asset-kind:invest',
      'asset-kind:immovable',
      'asset:house',
      'debt-kind:home_mortgage',
      'debt:kpr',
      'debt-kind:credit_card',
    ]);
  });
});

describe('yearChange', () => {
  const point = (month: string, netWorthMinor: number | null, assetsMinor = 1) => ({ month, netWorthMinor, assetsMinor, liabilitiesMinor: 0 });

  it('is today against the month-end twelve months back, with its per cent', () => {
    const points = [point('2025-11', 1_710_000_000), point('2026-10', 1_860_000_000)];
    expect(yearChange(points, '2026-11', 1_875_000_000)).toEqual({ changeMinor: 165_000_000, percent: 9.6 });
  });

  it('is not there when the history does not reach back, has no figure then, or held nothing then', () => {
    expect(yearChange([point('2026-01', 5)], '2026-11', 10)).toBeNull();
    expect(yearChange([point('2025-11', null)], '2026-11', 10)).toBeNull();
    expect(yearChange([{ month: '2025-11', netWorthMinor: 0, assetsMinor: 0, liabilitiesMinor: 0 }], '2026-11', 10)).toBeNull();
  });

  it('leaves the per cent out when that month was not above nought', () => {
    expect(yearChange([point('2025-11', -100)], '2026-11', 50)).toEqual({ changeMinor: 150, percent: null });
  });
});

describe('monthTicks', () => {
  it('names every month of a year when there is room, and fewer for five years, always the last', () => {
    expect(monthTicks(12, 600)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const long = monthTicks(60, 600);
    expect(long.at(-1)).toBe(59);
    expect(long.length).toBeLessThanOrEqual(17);
    expect(monthTicks(0, 600)).toEqual([]);
  });
});

describe('monthChange', () => {
  const point = (month: string, netWorthMinor: number | null, assetsMinor = 1) => ({ month, netWorthMinor, assetsMinor, liabilitiesMinor: 0 });

  it('is today against last month’s month-end, with its per cent and the month named', () => {
    const points = [point('2025-11', 1_000_000_000), point('2026-10', 1_836_000_000)];
    expect(monthChange(points, '2026-11', 1_875_000_000)).toEqual({ changeMinor: 39_000_000, percent: 2.1, since: 'October' });
  });

  it('reads a fall as a fall', () => {
    expect(monthChange([point('2026-10', 2_000_000)], '2026-11', 1_900_000)).toEqual({ changeMinor: -100_000, percent: -5, since: 'October' });
  });

  it('says nothing without last month’s figure, or when nothing was held then', () => {
    expect(monthChange([point('2026-09', 1_000)], '2026-11', 2_000)).toBeNull();
    expect(monthChange([point('2026-10', null)], '2026-11', 2_000)).toBeNull();
    expect(monthChange([point('2026-10', 0, 0)], '2026-11', 2_000)).toBeNull();
  });

  it('leaves the per cent out when last month was not above nothing; January looks back to December', () => {
    expect(monthChange([point('2026-10', -500)], '2026-11', 500)).toEqual({ changeMinor: 1_000, percent: null, since: 'October' });
    expect(monthChange([point('2025-12', 100)], '2026-01', 110)?.since).toBe('December');
  });
});

describe('debtsAgainstAssets', () => {
  it('is what is owed as a whole per cent of what is held', () => {
    expect(debtsAgainstAssets(440, 2_310)).toBe(19);
    expect(debtsAgainstAssets(0, 2_310)).toBe(0);
    expect(debtsAgainstAssets(3_000, 1_000)).toBe(300);
  });

  it('has nothing to say with nothing held', () => {
    expect(debtsAgainstAssets(100, 0)).toBeNull();
    expect(debtsAgainstAssets(100, -5)).toBeNull();
  });
});

describe('sheetLine', () => {
  const kind = (count: number) => ({ key: 'k', label: 'K', totalMinor: 0, share: 0, parts: [], items: Array.from({ length: count }, (_, i) => ({ accountId: `a${i}`, name: 'x', minor: 0, kind: { key: 'k', label: 'K' }, approx: false })) });
  it('names the day and counts each side’s rows', () => {
    expect(sheetLine('2026-11-21', { kinds: [kind(5), kind(3)], totalMinor: 0 }, { kinds: [kind(1)], totalMinor: 0 })).toBe('21 November 2026 · 8 assets · 1 debt');
  });
});
