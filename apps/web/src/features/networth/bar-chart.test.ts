import { describe, expect, it } from 'vitest';
import { barGeometry, type BarMonth } from './bar-chart';

/** A month with nothing but the two sides told: what is held, and what is owed. */
const month = (label: string, assets: number[], liabilities: number[], netWorthMinor?: number): BarMonth => ({
  label,
  netWorthMinor: netWorthMinor ?? assets.reduce((sum, part) => sum + part, 0) - liabilities.reduce((sum, part) => sum + part, 0),
  assets: assets.map((minor, index) => ({ key: `a${index}`, minor })),
  liabilities: liabilities.map((minor, index) => ({ key: `d${index}`, minor })),
});

/** No gutters, so every figure below is the drawing itself rather than the drawing plus its margins. */
const box = { width: 100, height: 100, left: 0, right: 0, top: 0, bottom: 0, barWidth: 10 } as const;

describe('barGeometry', () => {
  it('stands the line of nothing where the two sides have room to be drawn', () => {
    // Three hundred owned against a hundred owed: the debts get a quarter of the drawing, not half of it.
    const chart = barGeometry([month('Apr', [300], [100])], box);
    expect(chart.zeroY).toBeCloseTo(75);
    expect(chart.rects).toEqual([
      { key: 'a0', x: 45, y: 0, width: 10, height: 75, side: 'asset' },
      { key: 'd0', x: 45, y: 75, width: 10, height: 25, side: 'liability' },
    ]);
  });

  it('stacks a family on the one under it, out from nothing and down from it', () => {
    const chart = barGeometry([month('Apr', [100, 200], [300])], box);
    const [first, second, owed] = chart.rects;
    expect(chart.zeroY).toBeCloseTo(50);
    // The first family is the one nearest nothing and the next stands on it: the foot of one is the head of the other,
    // which is what makes the two of them a stack rather than two bars.
    expect(second!.y + second!.height).toBeCloseTo(first!.y);
    expect(first!.y + first!.height).toBeCloseTo(chart.zeroY);
    expect(second!.y).toBeCloseTo(0);
    expect(first).toMatchObject({ key: 'a0', side: 'asset' });
    expect(second).toMatchObject({ key: 'a1', side: 'asset' });
    expect(owed).toMatchObject({ key: 'd0', y: 50, height: 50, side: 'liability' });
  });

  it('draws the figure at the level it is: over the stacks when there is more than is owed, under them when not', () => {
    const up = barGeometry([month('Apr', [300], [100])], box);
    expect(up.points[0]).toMatchObject({ value: 200, label: 'Apr' });
    expect(up.points[0]!.y).toBeLessThan(up.zeroY);

    const down = barGeometry([month('Apr', [100], [300])], box);
    expect(down.points[0]).toMatchObject({ value: -200 });
    expect(down.points[0]!.y).toBeGreaterThan(down.zeroY);
  });

  it('draws nothing for a month that could not be added up, and breaks the figure there rather than through it', () => {
    const chart = barGeometry([month('Apr', [300], [100]), { label: 'May', netWorthMinor: null, assets: [], liabilities: [] }, month('Jun', [300], [100])], box);
    expect(chart.points.map((point) => point === null)).toEqual([false, true, false]);
    // One polyline either side of the missing month, and no block in its slot: two months of two sides is four.
    expect(chart.runs).toHaveLength(2);
    expect(chart.rects).toHaveLength(4);
    expect(chart.rects.some((rect) => Math.abs(rect.x - 45) < 0.001)).toBe(false);
    expect(chart.last?.label).toBe('Jun');
  });

  it('thins the ruling to twelve lines, however many months are drawn', () => {
    const months = Array.from({ length: 24 }, (_, index) => month(`M${index}`, [300], [100]));
    expect(barGeometry(months, box).guides).toHaveLength(12);
  });

  it('draws nothing, and divides nothing, when there are no months or nothing in them', () => {
    expect(barGeometry([], box)).toMatchObject({ rects: [], runs: [], points: [], guides: [], last: null });
    const empty = barGeometry([month('Apr', [], [])], box);
    expect(empty.rects).toEqual([]);
    // Nothing owed and nothing held is still a figure of nothing, drawn in the middle of the drawing's own room.
    expect(empty.points[0]).toMatchObject({ value: 0, y: empty.zeroY });
  });
});
