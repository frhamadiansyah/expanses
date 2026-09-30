import { formatMinor } from '@expanses/core';
import { dayLabel } from '../networth/asset-page';
import { ChartAnnouncement, ChartReading, useChartReading } from '../networth/chart-reading';
import { dayMonth } from '../networth/debt-rows';
import type { BalanceCrossing, DayBalance } from './balance-series';

/**
 * The tile's line: the balance over the last month, drawn so that "below nothing" is visible.
 *
 * Three things make it answer the question a figure cannot. The vertical range always *includes* nothing, so the
 * line can cross the reference rather than sit beside it. The line changes colour where it crosses, so green is
 * money you have and red is money you do not. And the crossing carries its date, drawn on the point itself — which
 * is why that point is interpolated between two readings instead of rounded to one.
 */
export function BalanceSpark({
  series,
  currency,
  crossing,
  readable = false,
  ends = ['30 days ago', 'today'],
  className,
}: {
  /** Oldest day first, ending on today's balance. */
  series: readonly DayBalance[];
  currency: string;
  crossing: BalanceCrossing | null;
  /**
   * The line can be read a day at a time, as Net worth's chart is: a touch or a drag (a mouse's pass, on a desk) shows
   * that day's balance and date over the line. The Accounts tile leaves it off — its figure is made of more than money.
   */
  readable?: boolean;
  /** The words under the line's two ends: "30 days ago … today", or "12 months ago … today" for a line of months. */
  ends?: readonly [string, string];
  className?: string;
}) {
  const width = 268;
  const height = 64;
  /* Room under the plot for the crossing's date, and nothing above: the chart starts at its own top. */
  const paper = height + 16;
  const values = series.map((day) => day.minor);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const span = top - bottom || 1;
  const x = (index: number) => (series.length <= 1 ? 0 : (index / (series.length - 1)) * width);
  const y = (minor: number) => ((top - minor) / span) * height;
  const at = (index: number) => `${x(index)},${y(series[index]!.minor)}`;

  // The crossing falls between two readings: the point is where the line meets nothing, not where a day does.
  const under = crossing ? series.findIndex((day) => day.on === crossing.on) : -1;
  const crossed = crossing && under > 0 ? { x: x(under - 1) + (x(under) - x(under - 1)) * crossing.through, y: y(0) } : null;
  const green = crossed ? [...series.slice(0, under).map((_, index) => at(index)), `${crossed.x},${crossed.y}`] : [];
  const red = crossed ? [`${crossed.x},${crossed.y}`, ...series.slice(under).map((_, index) => at(under + index))] : [];
  const flat = !crossed;
  const today = series.at(-1)!;
  /* One colour for a line that never crosses: the sign the figure above the chart is wearing. */
  const colour = today.minor < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)';
  const price = formatMinor(today.minor, currency);
  const points = series.map((day, index) => ({ x: x(index), y: y(day.minor), value: day.minor, label: dayLabel(day.on) }));
  const { reading, svgProps } = useChartReading(points, width, { label: 'Balance over the last 30 days. Tap a day to read it, or use the arrow keys.', hover: true });

  return (
    <div className={className}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${paper}`}
        role="img"
        aria-label={`${price} today${crossing ? `, below nothing since ${dayMonth(crossing.on)}` : ', above nothing all month'}`}
        {...(readable ? { ...svgProps, className: `overflow-visible ${svgProps.className}`, 'data-testid': 'balance-line' } : {})}
      >
        {/* Nothing, drawn as a reference rather than as the frame: the line is read against it, not from it. */}
        <line x1="0" y1={y(0)} x2={width} y2={y(0)} stroke="var(--ph-hair)" strokeWidth="1" strokeDasharray="2 3" />
        {flat ? (
          <>
            <polyline fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={series.map((_, index) => at(index)).join(' ')} />
            <circle cx={x(series.length - 1)} cy={y(today.minor)} r="3" fill={colour} />
          </>
        ) : (
          <>
            <polyline fill="none" stroke="var(--ph-tint)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={green.join(' ')} />
            <polyline fill="none" stroke="var(--ph-alarm)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={red.join(' ')} />
            <circle cx={crossed!.x} cy={crossed!.y} r="4" fill="var(--ph-alarm)" stroke="var(--ph-surface)" strokeWidth="1.5" />
            <text x={Math.min(Math.max(crossed!.x, 18), width - 18)} y={paper - 3} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--ph-alarm)">
              {dayMonth(crossing!.on)}
            </text>
            <circle cx={x(series.length - 1)} cy={y(today.minor)} r="3" fill="var(--ph-alarm)" />
          </>
        )}
        {/* The whole drawing is the target when it can be read: a thumb is wider than the line. */}
        {readable && <rect x={0} y={0} width={width} height={paper} fill="transparent" />}
        {readable && reading && <ChartReading point={reading} currency={currency} width={width} />}
      </svg>
      {readable && <ChartAnnouncement point={reading} currency={currency} />}
      <div className="mt-[2px] flex justify-between text-[11px] leading-[14px] text-[var(--ph-ink-3)]">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );
}
