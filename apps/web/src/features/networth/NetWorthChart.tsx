import { formatMinor } from '@expanses/core';
import { useId, useState } from 'react';
import { textWidth } from '../../ui/native';
import { type ChartPoint, chartGeometry, nearestIndex } from './value-chart';

/** The room a reading needs around it, and how far off its month it sits. */
const PILL_PAD = 10;
const PILL_HEIGHT = 44;
const PILL_GAP = 10;

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
export function NetWorthChart({ values, labels, currency }: { values: readonly (number | null)[]; labels: readonly string[]; currency: string }) {
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const chart = chartGeometry(values, labels, {
    width: 390,
    height: 200,
    // No gutter anywhere: nothing is written beside the line, so the drawing runs to the screen's own edges.
    left: 0,
    right: 0,
    top: PILL_HEIGHT + PILL_GAP,
    bottom: 12,
    throughZero: true,
    fillTo: 'zero',
  });
  if (chart.runs.length === 0) return null;

  const above = `${id}-above`;
  const below = `${id}-below`;
  const reading = picked === null ? null : (chart.points[picked] ?? null);
  /** Where a pointer is, in the drawing's own coordinates. */
  const at = (clientX: number, box: DOMRect) => ((clientX - box.left) / box.width) * chart.width;
  const pick = (event: React.PointerEvent<SVGSVGElement>) => setPicked(nearestIndex(chart.points, at(event.clientX, event.currentTarget.getBoundingClientRect())));
  /** The months a key can walk to: a month with no figure has nothing to read, so it is stepped over. */
  const months = chart.points.flatMap((point, index) => (point ? [index] : []));
  const step = (by: number) => {
    const from = months.indexOf(picked ?? months[0] ?? 0);
    const next = months[(from === -1 ? 0 : from + by + months.length) % months.length];
    if (next !== undefined) setPicked(next);
  };

  return (
    <>
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className="mt-[6px] h-auto w-full touch-pan-y select-none"
        role="group"
        tabIndex={0}
        aria-label="Net worth by month. Tap a month to read it, or use the arrow keys."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setScrubbing(true);
          pick(event);
        }}
        onPointerMove={(event) => scrubbing && pick(event)}
        onPointerUp={() => setScrubbing(false)}
        onPointerCancel={() => setScrubbing(false)}
        onBlur={() => setScrubbing(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            step(event.key === 'ArrowRight' ? 1 : -1);
          } else if (event.key === 'Escape') {
            setPicked(null);
          }
        }}
      >
        <defs>
          {/* Nothing is the line the figure is read against, so the wash is cut there. */}
          <clipPath id={above}>
            <rect x={0} y={0} width={chart.plotRight} height={Math.max(0, chart.zeroY)} />
          </clipPath>
          <clipPath id={below}>
            <rect x={0} y={chart.zeroY} width={chart.plotRight} height={Math.max(0, chart.plotBottom - chart.zeroY)} />
          </clipPath>
        </defs>
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
        {reading && <Reading point={reading} currency={currency} width={chart.width} />}
      </svg>
      {/* The same two things the reading draws, in the page as words and announced as they change. */}
      <p className="sr-only" aria-live="polite">
        {reading ? `${reading.label}: ${formatMinor(reading.value, currency)}` : ''}
      </p>
    </>
  );
}

/**
 * One month's figure, over the point it belongs to.
 *
 * Anchored above its month, and below it where the drawing has no room above — the top of the line is exactly where a
 * reading is most wanted, so it cannot be the one place it is not drawn — and kept between the drawing's own edges for
 * the same reason.
 */
function Reading({ point, currency, width }: { point: ChartPoint; currency: string; width: number }) {
  const money = formatMinor(point.value, currency);
  const box = Math.max(textWidth(money, 15), textWidth(point.label, 12.5)) + PILL_PAD * 2;
  const x = Math.min(Math.max(point.x - box / 2, 0), Math.max(0, width - box));
  const y = point.y - PILL_HEIGHT - PILL_GAP < 0 ? point.y + PILL_GAP : point.y - PILL_HEIGHT - PILL_GAP;
  return (
    <g data-testid="net-worth-reading">
      {/* A hairline down to the month it belongs to, so a reading in the middle of a year says which month it is. */}
      <line x1={point.x} x2={point.x} y1={Math.min(point.y, y)} y2={Math.max(point.y, y)} stroke="var(--ph-hair)" strokeWidth={1} />
      <circle cx={point.x} cy={point.y} r={4} fill={point.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)'} stroke="var(--ph-surface)" strokeWidth={2} />
      <rect x={x} y={y} width={box} height={PILL_HEIGHT} rx={9} fill="var(--ph-surface)" stroke="var(--ph-hair)" />
      <text x={x + box / 2} y={y + 18} textAnchor="middle" fontSize={12.5} fill="var(--ph-ink-3)">
        {point.label}
      </text>
      <text x={x + box / 2} y={y + 35} textAnchor="middle" fontSize={15} fontWeight={600} fill="var(--ph-ink)">
        {money}
      </text>
    </g>
  );
}
