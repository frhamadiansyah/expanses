import { describe, expect, it } from 'vitest';
import { barGeometry, chartGeometry } from './value-chart';

const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan'];

describe('chartGeometry', () => {
  it('keeps every point inside the drawing', () => {
    const chart = chartGeometry([1_000_000, 4_000_000, 2_500_000, 5_000_000], MONTHS);

    for (const point of chart.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(chart.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(chart.height);
    }
  });

  it('draws left to right, with one point per value', () => {
    const chart = chartGeometry([1, 2, 3, 4], MONTHS);
    expect(chart.points).toHaveLength(4);
    expect(chart.points.map((point) => point.x)).toEqual([...chart.points.map((point) => point.x)].sort((a, b) => a - b));
    expect(chart.line.split(' ')).toHaveLength(4);
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
    const ys = chart.points.map((point) => point.y);
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
    expect(chart.last.value).toBe(3_000_000);
  });
});

describe('barGeometry', () => {
  const zeroOf = (chart: ReturnType<typeof barGeometry>) => chart.ticks.find((tick) => tick.value === 0)!.y;

  it('draws a bar a month, each growing from nothing', () => {
    const chart = barGeometry([1_000_000, 3_000_000, 2_000_000], ['Apr', 'May', 'Jun']);
    expect(chart.bars).toHaveLength(3);
    for (const bar of chart.bars) expect(bar.y + bar.height).toBeCloseTo(zeroOf(chart), 6);
  });

  it('hangs a bar down from nothing when the month is money owed', () => {
    const chart = barGeometry([-5_000_000, 2_000_000], ['Aug', 'Sep']);
    expect(chart.bars[0]!.y).toBeCloseTo(zeroOf(chart), 6);
    expect(chart.bars[1]!.y + chart.bars[1]!.height).toBeCloseTo(zeroOf(chart), 6);
  });

  it('keeps the name for a month with no figure and draws no bar of nothing', () => {
    const chart = barGeometry([1_000_000, null, 2_000_000], ['Apr', 'May', 'Jun']);
    expect(chart.bars.map((bar) => bar.label)).toEqual(['Apr', 'Jun']);
  });

  it('always has nothing in range, so a bar below the line is money owed', () => {
    const chart = barGeometry([-5_000_000, -2_000_000], ['Aug', 'Sep']);
    expect(chart.ticks.some((tick) => tick.value === 0)).toBe(true);
  });

  it('copes with nothing known at all, rather than dividing by zero', () => {
    const chart = barGeometry([null, null], ['Aug', 'Sep']);
    expect(chart.bars).toHaveLength(0);
    expect(chart.ticks.length).toBeGreaterThan(0);
    expect(Number.isFinite(chart.ticks[0]!.y)).toBe(true);
  });

  it('keeps every bar inside the plot, clear of the axis labels', () => {
    const chart = barGeometry([1_000_000, 4_000_000, -2_000_000], ['A', 'B', 'C']);
    for (const bar of chart.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(chart.plotWidth);
      expect(bar.y).toBeGreaterThanOrEqual(0);
      expect(bar.y + bar.height).toBeLessThanOrEqual(chart.height);
    }
  });

  it('labels a year at every other month, so the names do not run together', () => {
    const year = Array.from({ length: 12 }, (_, index) => `M${index}`);
    expect(barGeometry(new Array(12).fill(1_000_000), year).labelEvery).toBe(2);
    expect(barGeometry(new Array(6).fill(1_000_000), year.slice(0, 6)).labelEvery).toBe(1);
  });
});
