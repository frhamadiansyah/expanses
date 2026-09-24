import { formatMinor } from '@expanses/core';

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

export interface ChartTick {
  y: number;
  value: number;
}

export interface ChartGeometry {
  width: number;
  height: number;
  /** Polyline points, "x,y x,y". */
  line: string;
  /** Closed path under the line, for the soft fill. */
  area: string;
  points: ChartPoint[];
  ticks: ChartTick[];
  last: ChartPoint;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/**
 * A figure short enough for an axis: millions as `jt`, billions as `M`.
 *
 * An axis label is read beside a gridline, not studied, so a tick says "-950 jt" rather than the twelve digits the
 * tooltip and the rows carry. The unit is the same one the app prints money in, abbreviated — never a second scale.
 */
export function shortMoney(minor: number, currency: string): string {
  const abs = Math.abs(minor);
  if (abs >= 1e9) return `${(minor / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (abs >= 1e6) return `${(minor / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  return formatMinor(minor, currency);
}

function niceStep(range: number): number {
  const power = 10 ** Math.floor(Math.log10(range));
  const scaled = range / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10) * power;
}

/**
 * Places a series of values in an SVG box. Every tick sits inside the drawing, and a flat
 * series still gets a line through the middle instead of collapsing onto an edge.
 */
export function chartGeometry(values: number[], labels: string[], options: ChartOptions = {}): ChartGeometry {
  const width = options.width ?? 640;
  const height = options.height ?? 180;
  const left = options.left ?? 74;
  const right = options.right ?? 16;
  const top = options.top ?? 18;
  const bottom = options.bottom ?? 26;
  const series = values.length > 0 ? values : [0];

  let low = Math.min(...series);
  let high = Math.max(...series);
  if (low === high) {
    const pad = Math.abs(high) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const step = niceStep((high - low) / 3);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  if (low < 0 && Math.min(...series) >= 0) low = 0;

  const x = (index: number) => (series.length === 1 ? left : left + (index * (width - left - right)) / (series.length - 1));
  const y = (value: number) => top + (height - top - bottom) * (1 - (value - low) / (high - low));

  const points: ChartPoint[] = series.map((value, index) => ({ x: x(index), y: y(value), value, label: labels[index] ?? '' }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `M${x(0)},${y(low)} L${points.map((point) => `${point.x},${point.y}`).join(' L')} L${x(series.length - 1)},${y(low)} Z`;

  const ticks: ChartTick[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push({ y: y(value), value });

  return { width, height, line, area, points, ticks, last: points[points.length - 1]! };
}

export interface ChartBar {
  /** The bar's box. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Its centre: where the month's gridline and its label go. */
  center: number;
  value: number;
  label: string;
}

export interface BarChart {
  width: number;
  height: number;
  bars: ChartBar[];
  /** The horizontal gridlines the axis is drawn from, nothing among them. */
  ticks: ChartTick[];
  /** How many months apart the labels under the axis are drawn. One a month until there are too many to read. */
  labelEvery: number;
  /** Where the bars stop: the axis labels are written in the gutter to the right of it, as Health writes them. */
  plotWidth: number;
}

/**
 * A bar a month, growing from nothing, with the axis always through it.
 *
 * A month with no figure — a rate missing that month — draws no bar and keeps its gridline and its name: a gap in a
 * chart is a fact about the data, and a bar of nothing would be a fact that is not true. Nothing is always in range,
 * so a bar below the line is money owed and a bar above it is money held, which is the whole point of the drawing.
 */
export function barGeometry(values: readonly (number | null)[], labels: readonly string[], options: ChartOptions = {}): BarChart {
  const width = options.width ?? 390;
  const height = options.height ?? 200;
  const top = options.top ?? 16;
  // The month names sit inside the box at its foot, as the day names do in Health's chart.
  const bottom = options.bottom ?? 22;
  // And the figures the axis is read by sit in a gutter at its right, clear of the bars they measure.
  const right = options.right ?? 46;
  const plot = height - top - bottom;
  const plotWidth = Math.max(1, width - right);
  const known = values.filter((value): value is number => value !== null);

  let low = Math.min(0, ...known);
  let high = Math.max(0, ...known);
  if (low === high) {
    // Nothing known, or every month the same: an axis needs a height even so, or the maths divides by zero.
    const pad = Math.abs(high) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const step = niceStep((high - low) / 3);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;

  const y = (value: number) => top + plot * (1 - (value - low) / (high - low));
  const pitch = plotWidth / Math.max(1, values.length);
  const barWidth = Math.max(3, pitch * 0.62);
  const bars: ChartBar[] = values.flatMap((value, index) => {
    if (value === null) return [];
    const zero = y(0);
    const at = y(value);
    return [
      {
        x: index * pitch + (pitch - barWidth) / 2,
        y: Math.min(zero, at),
        width: barWidth,
        height: Math.abs(at - zero),
        center: index * pitch + pitch / 2,
        value,
        label: labels[index] ?? '',
      },
    ];
  });

  const ticks: ChartTick[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push({ y: y(value), value });

  return { width, height, bars, ticks, labelEvery: values.length > 8 ? 2 : 1, plotWidth };
}
