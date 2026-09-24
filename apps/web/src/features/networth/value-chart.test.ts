import { describe, expect, it } from 'vitest';
import { textWidth } from '../../ui/native';
import { type ChartPoint, chartGeometry, nearestIndex } from './value-chart';

const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan'];
const pointsOf = (chart: ReturnType<typeof chartGeometry>) => chart.points.filter((point): point is ChartPoint => point !== null);

describe('chartGeometry', () => {
  it('keeps every point inside the drawing', () => {
    const chart = chartGeometry([1_000_000, 4_000_000, 2_500_000, 5_000_000], MONTHS);

    for (const point of pointsOf(chart)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(chart.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(chart.height);
    }
  });

  it('draws left to right, with one point per value', () => {
    const chart = chartGeometry([1, 2, 3, 4], MONTHS);
    expect(chart.points).toHaveLength(4);
    const xs = pointsOf(chart).map((point) => point.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(chart.runs[0]!.split(' ')).toHaveLength(4);
  });

  it('puts the highest value above the lowest', () => {
    const chart = chartGeometry([1_000_000, 5_000_000], ['Jan', 'Feb']);
    expect(chart.points[1]!.y).toBeLessThan(chart.points[0]!.y);
  });

  it('keeps the last point for the end label', () => {
    const chart = chartGeometry([1_000_000, 5_000_000], ['Jan', 'Feb']);
    expect(chart.last).toMatchObject({ value: 5_000_000, label: 'Feb' });
  });

  it('still draws a line when every value is the same', () => {
    const chart = chartGeometry([2_000_000, 2_000_000, 2_000_000], ['Jan', 'Feb', 'Mar']);
    const ys = pointsOf(chart).map((point) => point.y);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeGreaterThan(0);
    expect(ys[0]).toBeLessThan(chart.height);
  });

  it('labels ticks with values the chart reaches, from low to high', () => {
    const chart = chartGeometry([1_000_000, 5_000_000], ['Jan', 'Feb']);
    expect(chart.ticks.length).toBeGreaterThanOrEqual(3);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([...chart.ticks.map((tick) => tick.value)].sort((a, b) => a - b));
    expect(chart.ticks[0]!.value).toBeLessThanOrEqual(1_000_000);
    expect(chart.ticks[chart.ticks.length - 1]!.value).toBeGreaterThanOrEqual(5_000_000);
    for (const tick of chart.ticks) expect(tick.y).toBeLessThanOrEqual(chart.height);
  });

  it('never goes below zero for a series that is all positive', () => {
    const chart = chartGeometry([1_000_000, 5_000_000], ['Jan', 'Feb']);
    expect(chart.ticks[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('copes with a single point', () => {
    const chart = chartGeometry([3_000_000], ['Sep']);
    expect(chart.points).toHaveLength(1);
    expect(chart.last!.value).toBe(3_000_000);
  });

  it('copes with nothing known at all, rather than dividing by zero', () => {
    const chart = chartGeometry([null, null], ['Aug', 'Sep']);
    expect(chart.runs).toEqual([]);
    expect(chart.last).toBeNull();
    expect(chart.ticks.length).toBeGreaterThan(0);
    expect(Number.isFinite(chart.ticks[0]!.y)).toBe(true);
  });
});

describe('a figure that can be owed', () => {
  it('reaches across nothing, so a month in the red is drawn below the line', () => {
    const chart = chartGeometry([-5_000_000, 2_000_000], ['Aug', 'Sep'], { throughZero: true });
    expect(chart.ticks.some((tick) => tick.value === 0)).toBe(true);
    expect(chart.points[0]!.y).toBeGreaterThan(chart.zeroY);
    expect(chart.points[1]!.y).toBeLessThan(chart.zeroY);
  });

  it('fills down to nothing rather than to the floor, so the wash is the money itself', () => {
    const chart = chartGeometry([-2_000_000, 3_000_000], ['Aug', 'Sep'], { throughZero: true, fillTo: 'zero' });
    // The floor of the axis is below nothing, and the wash is closed against nothing rather than against the floor.
    expect(chart.plotBottom).toBeGreaterThan(chart.zeroY);
    expect(chart.areas[0]!.startsWith(`M${chart.points[0]!.x},${chart.zeroY}`)).toBe(true);
  });

  it('breaks the line at a month with no figure instead of drawing through it', () => {
    const chart = chartGeometry([1_000_000, null, 3_000_000], ['Jun', 'Jul', 'Aug']);
    expect(chart.points[1]).toBeNull();
    expect(chart.runs).toHaveLength(2);
    expect(chart.areas).toHaveLength(2);
    expect(chart.last!.value).toBe(3_000_000);
  });

  it('keeps a month with no figure in the series, because the month is still a month', () => {
    const chart = chartGeometry([1_000_000, null, 3_000_000], ['Jun', 'Jul', 'Aug']);
    expect(chart.points).toHaveLength(3);
    expect(chart.points[1]).toBeNull();
  });

  it('writes nothing outside the line when the drawing has no axis', () => {
    const chart = chartGeometry([1_000_000, 2_000_000], ['Aug', 'Sep'], { width: 390, left: 0, right: 0 });
    expect(chart.plotRight).toBe(390);
    for (const point of pointsOf(chart)) expect(point.x).toBeLessThanOrEqual(chart.plotRight);
  });
});

describe('nearestIndex', () => {
  const chart = chartGeometry([1_000_000, 2_000_000, 3_000_000], ['Jun', 'Jul', 'Aug'], { left: 0, right: 0, width: 300 });

  it('reads the month a tap landed on', () => {
    expect(nearestIndex(chart.points, 0)).toBe(0);
    expect(nearestIndex(chart.points, 150)).toBe(1);
    expect(nearestIndex(chart.points, 299)).toBe(2);
  });

  it('rounds to the nearer of two months rather than always the earlier', () => {
    expect(nearestIndex(chart.points, 70)).toBe(0);
    expect(nearestIndex(chart.points, 80)).toBe(1);
  });

  it('passes over a month with no figure, because there is nothing there to read', () => {
    const gap = chartGeometry([1_000_000, null, 3_000_000], ['Jun', 'Jul', 'Aug'], { left: 0, right: 0, width: 300 });
    expect(nearestIndex(gap.points, 150)).toBe(0);
  });

  it('answers nothing when no month has a figure at all', () => {
    expect(nearestIndex([null, null], 100)).toBeNull();
  });
});
