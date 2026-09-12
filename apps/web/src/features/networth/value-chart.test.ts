import { describe, expect, it } from 'vitest';
import { chartGeometry } from './value-chart';

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
