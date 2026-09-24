import { useId } from 'react';
import { textWidth } from '../../ui/native';
import { chartGeometry, shortMoney } from './value-chart';

/**
 * Net worth as the line it is, drawn across the whole screen.
 *
 * Health's metric with this figure in it: no box and no gutter at the sides, so the months read as a shape rather
 * than as a picture in a frame. The figures the axis is read by sit in the gutter at the right, clear of the line
 * they measure, and the month names in the foot inside it.
 *
 * The drawing is the line and its wash, cut at nothing: the same path is drawn twice, tinted above nothing and
 * alarm below it. That split is the one thing a line in a single colour cannot say, and this is the figure that
 * goes negative. Hand-drawn SVG: no chart library in this app.
 */
export function NetWorthChart({ values, labels, currency }: { values: readonly (number | null)[]; labels: readonly string[]; currency: string }) {
  const id = useId();
  const chart = chartGeometry(values, labels, {
    width: 390,
    height: 200,
    // No gutter at the left: the figure the axis is read by is already written above this drawing, so the grid runs
    // from one screen edge to the other and the months are the only names on it.
    left: 0,
    right: 46,
    top: 16,
    bottom: 22,
    throughZero: true,
    fillTo: 'zero',
    // The names a long range writes carry a year, so the geometry is told how wide they come out at this size.
    nameWidth: labels.reduce((widest, label) => Math.max(widest, textWidth(label, 11)), 0),
  });
  if (chart.runs.length === 0) return null;
  const above = `${id}-above`;
  const below = `${id}-below`;
  return (
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="mt-[6px] h-auto w-full" role="img" aria-label="Net worth by month">
      <defs>
        {/* Nothing is the line the figure is read against, so the wash is cut there. */}
        <clipPath id={above}>
          <rect x={0} y={0} width={chart.plotRight} height={Math.max(0, chart.zeroY)} />
        </clipPath>
        <clipPath id={below}>
          <rect x={0} y={chart.zeroY} width={chart.plotRight} height={Math.max(0, chart.plotBottom - chart.zeroY)} />
        </clipPath>
      </defs>
      {chart.ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={0} x2={chart.width} y1={tick.y} y2={tick.y} stroke="var(--ph-hair)" strokeWidth={1} />
          <text x={chart.width - 6} y={tick.y - 4} textAnchor="end" fontSize={11} fill="var(--ph-ink-3)">
            {shortMoney(tick.value, currency)}
          </text>
        </g>
      ))}
      {[
        { clip: above, colour: 'var(--ph-tint)' },
        { clip: below, colour: 'var(--ph-alarm)' },
      ].map((half) => (
        <g key={half.clip} clipPath={`url(#${half.clip})`}>
          {chart.areas.map((area, index) => (
            <path key={`area-${index}`} d={area} fill={half.colour} fillOpacity={0.16} stroke="none" />
          ))}
          {chart.runs.map((run, index) => (
            <polyline key={`run-${index}`} points={run} fill="none" stroke={half.colour} strokeWidth={2} strokeLinejoin="round" />
          ))}
        </g>
      ))}
      {/* The months along the foot, inside the drawing as Health keeps them. Their own group, so a test can read them. */}
      <g data-testid="net-worth-months">
        {chart.names.map((name) => (
          <text
            key={`${name.label}-${name.x}`}
            x={name.x}
            y={chart.height - 6}
            /* The line starts at the screen's own edge, so the first month's name reads inward from it: a name centred
               on the edge hangs half of itself off the screen. */
            textAnchor={name.x === 0 ? 'start' : 'middle'}
            fontSize={11}
            fill="var(--ph-ink-3)"
          >
            {name.label}
          </text>
        ))}
      </g>
    </svg>
  );
}
