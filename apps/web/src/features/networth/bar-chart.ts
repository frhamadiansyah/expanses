import type { ChartPoint } from './value-chart';

/** One family's share of a month: what it is worth then. Nothing about how it is drawn. */
export interface BarSlice {
  key: string;
  minor: number;
}

/**
 * A month as the bars draw it: what it holds, what it owes, and the figure the two come to.
 *
 * The slices are handed over whole — every family of the assets and every kind of debt, zeros included — so a month is
 * stacked the same way as the month beside it. A month that could not be added up hands over nothing at all.
 */
export interface BarMonth {
  label: string;
  /** Null where the month has no figure, which is also the month with nothing to stack. */
  netWorthMinor: number | null;
  assets: readonly BarSlice[];
  liabilities: readonly BarSlice[];
}

/** One block of a stack: where it is drawn, and which side of nothing it is on. */
export interface BarRect {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Assets stand on the nothing line and debts hang under it, and the two are read as two different things. */
  side: 'asset' | 'liability';
}

export interface BarOptions {
  width?: number;
  height?: number;
  left?: number;
  right?: number;
  /** Room above the drawing: where a reading is written, since nothing is written beside it. */
  top?: number;
  bottom?: number;
  /** How wide one month may get: the rest of the slot stays white, as a bar with air around it. */
  barWidth?: number;
}

export interface BarGeometry {
  width: number;
  height: number;
  /** Where nothing is: the line the assets stand on and the debts hang from. */
  zeroY: number;
  /** A hairline a month, thinned to as many as read as a grid rather than as a fill. */
  guides: number[];
  /** Every block, assets first, in the order they are stacked. */
  rects: BarRect[];
  /**
   * The figure over the stacks, one polyline per run of months that have one.
   *
   * A month with no figure breaks the line rather than being drawn as nothing, exactly as the line view does: what is
   * missing is the reading, not the month.
   */
  runs: string[];
  /** Where the figure sits, one point a month: what a tap reads, and where its dot is drawn. */
  points: (ChartPoint | null)[];
  /** The last month with a figure. */
  last: ChartPoint | null;
  plotRight: number;
  plotBottom: number;
}

/**
 * Months as stacked bars: what you own above nothing, what you owe below it, and the net worth over the two.
 *
 * The nothing line is not the middle of the drawing. It is placed by how much there is to draw on each side, so a month
 * owing three times what it holds gives the debts three times the room — the alternative is one side squashed against
 * the edge to keep a symmetry nobody is reading. The two sides are measured on their own scales for the same reason: a
 * shape of 1.5 billion standing on one of 1.4 billion is the point of the drawing, and two scales that agreed on a
 * maximum would make the debts look small.
 *
 * The figure is drawn where it falls between the two: assets up from nothing, debts down from it, so the net worth sits
 * at the level it is — above nothing when there is more than is owed, below it when there is not.
 */
export function barGeometry(months: readonly BarMonth[], options: BarOptions = {}): BarGeometry {
  const width = options.width ?? 390;
  const height = options.height ?? 230;
  const left = options.left ?? 6;
  const right = options.right ?? 6;
  const top = options.top ?? 14;
  const bottom = options.bottom ?? 12;
  const widest = options.barWidth ?? 34;
  const plotBottom = height - bottom;

  const sum = (slices: readonly BarSlice[]) => slices.reduce((total, slice) => total + Math.max(0, slice.minor), 0);
  const high = Math.max(0, ...months.map((month) => sum(month.assets)));
  const low = Math.max(0, ...months.map((month) => sum(month.liabilities)));
  /*
   * The scale of a side nobody drew on is 1, not 0: a workspace holding nothing but debt still needs a line to hang it
   * from, and dividing by nothing is what would put that line in the middle of nowhere. The other side's room is what
   * it is; the empty one takes the pixels it was given and draws no blocks.
   */
  const upScale = Math.max(high, 1);
  const downScale = Math.max(low, 1);
  const zeroY = top + ((plotBottom - top) * upScale) / (upScale + downScale);
  const up = (minor: number) => (minor / upScale) * (zeroY - top);
  const down = (minor: number) => (minor / downScale) * (plotBottom - zeroY);

  const pitch = months.length === 0 ? 0 : (width - left - right) / months.length;
  const barWidth = Math.min(widest, pitch * 0.62);

  const rects: BarRect[] = [];
  const points: (ChartPoint | null)[] = [];
  const centres: number[] = [];
  months.forEach((month, index) => {
    const centre = left + index * pitch + pitch / 2;
    centres.push(centre);
    const x = centre - barWidth / 2;
    let standing = zeroY;
    for (const slice of month.assets) {
      const block = up(Math.max(0, slice.minor));
      if (block <= 0) continue;
      standing -= block;
      rects.push({ key: slice.key, x, y: standing, width: barWidth, height: block, side: 'asset' });
    }
    let hanging = zeroY;
    for (const slice of month.liabilities) {
      const block = down(Math.max(0, slice.minor));
      if (block <= 0) continue;
      rects.push({ key: slice.key, x, y: hanging, width: barWidth, height: block, side: 'liability' });
      hanging += block;
    }
    const net = month.netWorthMinor;
    points.push(net === null ? null : { x: centre, y: net >= 0 ? zeroY - up(net) : zeroY + down(-net), value: net, label: month.label });
  });

  const runs: string[] = [];
  let run: ChartPoint[] = [];
  const close = () => {
    if (run.length === 0) return;
    runs.push(run.map((point) => `${point.x},${point.y}`).join(' '));
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else close();
  }
  close();

  // A line a month until a month is narrower than the gap beside it, as the line view thins them.
  const guideEvery = Math.max(1, Math.ceil(months.length / 12));
  const guides = centres.filter((_, index) => index % guideEvery === 0);

  return {
    width,
    height,
    zeroY,
    guides,
    rects,
    runs,
    points,
    last: [...points].reverse().find((point) => point !== null) ?? null,
    plotRight: width - right,
    plotBottom,
  };
}
