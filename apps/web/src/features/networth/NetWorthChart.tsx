import { useId } from 'react';
import { ChartAnnouncement, ChartReading, READING_ROOM, useChartReading } from './chart-reading';
import { chartGeometry } from './value-chart';

/**
 * Net worth as the line it is, drawn across the whole screen.
 *
 * Health's metric with this figure in it: no box, no gutter and **no axis** — the screen's own edges are the drawing's,
 * and the only thing on it is the line. What a grid and a pair of axes would have printed is asked for instead: a tap
 * picks the month under it and the figure is written over the point, which is one number read at a time rather than
 * thirty of them printed small enough to be none. The arrows walk the months on a keyboard, and Escape lets go.
 *
 * The drawing is the line and its wash, cut at nothing: the same path is drawn twice, tinted above nothing and alarm
 * below it. That split is the one thing a line in a single colour cannot say, and this is the figure that goes
 * negative. Hand-drawn SVG: no chart library in this app.
 */
export function NetWorthChart({ values, labels, currency, height }: { values: readonly (number | null)[]; labels: readonly string[]; currency: string; height: number }) {
  const id = useId();
  const chart = chartGeometry(values, labels, {
    width: 390,
    /* The box decides how tall this is, not the drawing: the two views are the same height so the page below them
     * never moves when the answer changes shape. */
    height,
    // No gutter anywhere: nothing is written beside the line, so the drawing runs to the screen's own edges.
    left: 0,
    right: 0,
    top: READING_ROOM,
    bottom: 12,
    throughZero: true,
    fillTo: 'zero',
  });
  const { reading, svgProps } = useChartReading(chart.points, chart.width);
  if (chart.runs.length === 0) return null;

  const above = `${id}-above`;
  const below = `${id}-below`;
  return (
    <>
      {/* The class the reading hands over carries the tap behaviour; what is added here is where the drawing sits. */}
      <svg data-testid="net-worth-line-view" viewBox={`0 0 ${chart.width} ${chart.height}`} {...svgProps} className={`mt-[6px] h-auto w-full ${svgProps.className}`}>
        <defs>
          {/* Nothing is the line the figure is read against, so the wash is cut there. */}
          <clipPath id={above}>
            <rect x={0} y={0} width={chart.plotRight} height={Math.max(0, chart.zeroY)} />
          </clipPath>
          <clipPath id={below}>
            <rect x={0} y={chart.zeroY} width={chart.plotRight} height={Math.max(0, chart.plotBottom - chart.zeroY)} />
          </clipPath>
        </defs>
        {/*
         * The ruling first, behind everything: a hairline a month, so the line is read against the months rather than
         * floating on white. Nothing is written on them — the reading is what says the figures.
         */}
        <g aria-hidden>
          {chart.guides.map((at) => (
            <line key={at} x1={at} x2={at} y1={0} y2={chart.height} stroke="var(--ph-hair)" strokeWidth={1} />
          ))}
        </g>
        {[
          { clip: above, colour: 'var(--ph-tint)' },
          { clip: below, colour: 'var(--ph-alarm)' },
        ].map((half) => (
          <g key={half.clip} clipPath={`url(#${half.clip})`}>
            {chart.areas.map((area, index) => (
              <path key={`area-${index}`} d={area} fill={half.colour} fillOpacity={0.16} stroke="none" />
            ))}
            {chart.runs.map((run, index) => (
              <polyline key={`run-${index}`} data-testid="net-worth-line" points={run} fill="none" stroke={half.colour} strokeWidth={2} strokeLinejoin="round" />
            ))}
          </g>
        ))}
        {/* The whole drawing is the target, not the line's own two pixels: a thumb is wider than a stroke. */}
        <rect data-testid="net-worth-plot" x={0} y={0} width={chart.width} height={chart.height} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={chart.width} />}
      </svg>
      <ChartAnnouncement point={reading} currency={currency} />
    </>
  );
}
