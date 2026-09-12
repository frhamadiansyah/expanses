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
