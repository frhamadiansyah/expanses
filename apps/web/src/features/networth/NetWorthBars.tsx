import { barGeometry, type BarMonth } from './bar-chart';
import { ChartAnnouncement, ChartReading, READING_ROOM, useChartReading } from './chart-reading';
import type { StackKey } from './stack-keys';

/**
 * Net worth as what it is made of: a stack a month, what you own above nothing and what you owe below it.
 *
 * The same series as the line, drawn as its parts rather than as its total. A line answers "where is it going"; a stack
 * answers "what is it" — that a flat year was a year of borrowing, or that the investing happened while the cash went
 * out. The figure itself is not lost with the shape: it is drawn over the stacks as a line, so a month still reads as
 * one number, and a tap reads that number out exactly as the line view does.
 *
 * Nothing is written beside or under the drawing — no axis, no scale, no month names — for the same reason the line view
 * has none. What the colours mean is the key under it, and what a month is worth is the reading.
 */
export function NetWorthBars({ months, keys, currency }: { months: readonly BarMonth[]; keys: readonly StackKey[]; currency: string }) {
  const chart = barGeometry(months, { width: 390, height: 230, left: 6, right: 6, top: READING_ROOM, bottom: 12 });
  const { reading, svgProps } = useChartReading(chart.points, chart.width);
  if (chart.rects.length === 0 && chart.points.every((point) => point === null)) return null;
  const fillOf = new Map(keys.map((key) => [key.key, key.fill]));
  /*
   * The key names what the drawing holds and nothing else: a family no month holds is a colour with no block to explain,
   * and seven of them put a two-line key under every chart. The order is the stacking order either way.
   */
  const held = new Set(months.flatMap((month) => [...month.assets, ...month.liabilities]).flatMap((slice) => (slice.minor > 0 ? [slice.key] : [])));
  const heldKeys = keys.filter((key) => held.has(key.key));

  return (
    <>
      <svg data-testid="net-worth-bars" viewBox={`0 0 ${chart.width} ${chart.height}`} {...svgProps} className={`mt-[6px] h-auto w-full ${svgProps.className}`}>
        {/*
         * The ruling behind the bars, and the line they stand on: the same hairlines the line view draws, plus nothing
         * itself. The stacks are read from that line outwards, so it is the one thing on the drawing that has to be
         * there.
         */}
        <g aria-hidden>
          {chart.guides.map((at) => (
            <line key={at} x1={at} x2={at} y1={0} y2={chart.height} stroke="var(--ph-hair)" strokeWidth={1} />
          ))}
          <line x1={0} x2={chart.width} y1={chart.zeroY} y2={chart.zeroY} stroke="var(--ph-hair)" strokeWidth={1} />
        </g>
        {/* One block a family, in the family's own colour — the same colours the sheet's own bars are drawn in. */}
        <g aria-hidden>
          {chart.rects.map((rect, index) => (
            <rect
              key={`${rect.key}-${index}`}
              data-key={rect.key}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              className={fillOf.get(rect.key)}
            />
          ))}
        </g>
        {/*
         * The figure over the stacks, dashed so it reads as the reading rather than as one more block, and dotted a
         * month: tinted above nothing and alarmed below it, exactly as the line view cuts the same figure.
         */}
        <g aria-hidden>
          {chart.runs.map((run, index) => (
            <polyline key={`run-${index}`} data-testid="net-worth-bar-line" points={run} fill="none" stroke="var(--ph-ink)" strokeWidth={1.5} strokeDasharray="3 3" strokeOpacity={0.55} />
          ))}
          {chart.points.map((point, index) =>
            point === null ? null : (
              <circle key={`dot-${index}`} cx={point.x} cy={point.y} r={3.5} fill={point.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)'} stroke="var(--ph-surface)" strokeWidth={1.5} />
            ),
          )}
        </g>
        {/* The whole drawing is the target, as it is on the line: a thumb is wider than a bar. */}
        <rect data-testid="net-worth-plot" x={0} y={0} width={chart.width} height={chart.height} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={chart.width} />}
      </svg>
      {/* What the colours mean. No percentages: a key says which money is which, and the reading says how much. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-[8px] text-[12.5px] text-[var(--ph-ink-3)] md:px-0">
        {heldKeys.map((key) => (
          <span key={key.key} className="flex items-center gap-1.5">
            <i className={`h-2 w-2 rounded-sm ${key.className}`} />
            {key.label}
          </span>
        ))}
      </div>
      <ChartAnnouncement point={reading} currency={currency} />
    </>
  );
}
