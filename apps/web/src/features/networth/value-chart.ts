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
  /**
   * One polyline per run of months that have a figure. A month with no figure — a rate missing that month — breaks
   * the line instead of being drawn as nothing: a gap is a fact about the data, and a line drawn through it says the
   * figure was there all along.
   */
  runs: string[];
  /** The fill under each run, closed against the floor, so a gap is a gap in the fill too. */
  areas: string[];
  points: (ChartPoint | null)[];
  ticks: ChartTick[];
  /**
   * Where a month sits across the drawing, thinned to as many guides as read as a grid rather than as a fill.
   *
   * Nothing is written on them — they are the ruling the line is read against, which is what keeps a chart on white
   * from being a line floating in white.
   */
  guides: number[];
  /** Where nothing is drawn: the line above it is money held and below it money owed. */
  zeroY: number;
  /** The last month with a figure: the end of the line, and where a dot is drawn for today. */
  last: ChartPoint | null;
  /** Where the plot stops, so a caller can write its figures in the gutter beyond and its names in the foot below. */
  plotRight: number;
  plotBottom: number;
}

export interface ChartOptions {
  width?: number;
  height?: number;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /**
   * Whether nothing is always in range.
   *
   * No for a series of values, where reaching below nothing is an error rather than a reading; yes for net worth,
   * where the line crossing it is the whole of what the chart is for.
   */
  throughZero?: boolean;
  /**
   * What the fill reaches down to: the floor of the axis, or nothing.
   *
   * A value has climbed from somewhere and the area says how far; a balance is held, so the area between the line
   * and nothing is the money itself, and its sign is read off which side of the line it is on.
   */
  fillTo?: 'floor' | 'zero';
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
 * A step the eye can divide by: a round number near the one asked for, so a gridline falls on a figure somebody would
 * have chosen. Shared with the bars, which rule their own drawing the same way.
 */
export function gridStep(range: number): number {
  // Never under one: a step under a minor unit is a grid with more lines than the drawing has pixels.
  return Math.max(1, niceStep(range));
}

/**
 * Places a series of values in an SVG box. Every tick sits inside the drawing, and a flat
 * series still gets a line through the middle instead of collapsing onto an edge.
 */
export function chartGeometry(values: readonly (number | null)[], labels: readonly string[], options: ChartOptions = {}): ChartGeometry {
  const width = options.width ?? 640;
  const height = options.height ?? 180;
  const left = options.left ?? 74;
  const right = options.right ?? 16;
  const top = options.top ?? 18;
  const bottom = options.bottom ?? 26;
  const known = values.filter((value): value is number => value !== null);
  const series = known.length > 0 ? known : [0];

  let low = Math.min(...series);
  let high = Math.max(...series);
  if (options.throughZero) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  if (low === high) {
    const pad = Math.abs(high) * 0.1 || 1;
    low -= pad;
    high += pad;
  }
  const step = niceStep((high - low) / 3);
  low = Math.floor(low / step) * step;
  high = Math.ceil(high / step) * step;
  if (low < 0 && Math.min(...series) >= 0) low = 0;
  const x = (index: number) => (values.length === 1 ? left : left + (index * (width - left - right)) / (values.length - 1));
  const y = (value: number) => top + (height - top - bottom) * (1 - (value - low) / (high - low));

  const points: (ChartPoint | null)[] = values.map((value, index) => (value === null ? null : { x: x(index), y: y(value), value, label: labels[index] ?? '' }));
  const floor = options.fillTo === 'zero' ? y(0) : y(low);
  const runs: string[] = [];
  const areas: string[] = [];
  let run: ChartPoint[] = [];
  const close = () => {
    if (run.length === 0) return;
    runs.push(run.map((point) => `${point.x},${point.y}`).join(' '));
    areas.push(`M${run[0]!.x},${floor} L${run.map((point) => `${point.x},${point.y}`).join(' L')} L${run[run.length - 1]!.x},${floor} Z`);
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else close();
  }
  close();

  const ticks: ChartTick[] = [];
  for (let value = low; value <= high + step / 2; value += step) ticks.push({ y: y(value), value });

  /*
   * A line a month until a month is narrower than the gap beside it, then every few — a grid of twelve at most, which
   * is the most that reads as a grid on a phone and not as a hatch.
   */
  const guideEvery = Math.max(1, Math.ceil(values.length / 12));
  const guides = values.flatMap((_, index) => (index % guideEvery === 0 ? [x(index)] : []));

  return {
    width,
    height,
    runs,
    areas,
    points,
    ticks,
    guides,
    zeroY: y(0),
    last: [...points].reverse().find((point) => point !== null) ?? null,
    plotRight: width - right,
    plotBottom: height - bottom,
  };
}

/**
 * The month nearest a place on the drawing: what a tap on the chart asks for.
 *
 * A month with no figure is not a month anyone can read, so it is passed over rather than answered with an empty
 * reading. Null when no month has a figure at all.
 */
export function nearestIndex(points: readonly (ChartPoint | null)[], x: number): number | null {
  let best: number | null = null;
  let closest = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    if (!point) return;
    const gap = Math.abs(point.x - x);
    if (gap < closest) {
      closest = gap;
      best = index;
    }
  });
  return best;
}

