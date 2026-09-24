import { formatMinor } from '@expanses/core';
import { barGeometry, shortMoney } from './value-chart';

/**
 * Net worth drawn the way Apple Health draws a metric: a bar a month, on a grid.
 *
 * The line the year used to be drawn as cannot show a sign crossed — a bar growing down from nothing says money owed at
 * a glance, which is the one thing this figure is. Hand-drawn SVG: no chart library in this app.
 */
export function NetWorthChart({ values, labels, currency }: { values: readonly (number | null)[]; labels: readonly string[]; currency: string }) {
  const chart = barGeometry(values, labels);
  if (chart.bars.length === 0) return null;
  return (
    /*
     * Full-bleed, and on the band rather than in a box: the grid runs from one screen edge to the other, as Health's
     * does, so the months read as a shape instead of a picture in a frame. The axis labels sit inside the plot at the
     * right, which is where Health keeps them too.
     */
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="mt-[6px] h-auto w-full" role="img" aria-label="Net worth by month">
      {chart.ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={0} x2={chart.width} y1={tick.y} y2={tick.y} stroke="var(--ph-hair)" strokeWidth={1} />
          <text x={chart.width - 6} y={tick.y - 4} textAnchor="end" fontSize={11} fill="var(--ph-ink-3)">
            {shortMoney(tick.value, currency)}
          </text>
        </g>
      ))}
      {chart.bars.map((bar, index) => (
        <g key={`${bar.label}-${index}`}>
          {/* A dashed line a month, as Health rules its days: the bar is read against its own month. */}
          <line x1={bar.center} x2={bar.center} y1={0} y2={chart.height} stroke="var(--ph-hair)" strokeWidth={1} strokeDasharray="2 3" />
          {index % chart.labelEvery === 0 && (
            <text x={bar.center} y={chart.height - 6} textAnchor="middle" fontSize={11} fill="var(--ph-ink-3)">
              {bar.label}
            </text>
          )}
          <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={2} fill={bar.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)'} />
        </g>
      ))}
    </svg>
  );
}
