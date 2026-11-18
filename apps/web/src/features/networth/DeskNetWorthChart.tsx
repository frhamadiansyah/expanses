import { useCallback, useId, useRef, useState } from 'react';
import { barGeometry, type BarMonth } from './bar-chart';
import { ChartAnnouncement, ChartReading, useChartReading } from './chart-reading';
import { monthTicks } from './networth-desk-model';
import type { StackKey } from './stack-keys';
import { chartGeometry, shortMoney } from './value-chart';

/** A box's own width, followed as it changes (the peek opening, the window resized). */
export function useBoxWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    observer.current.observe(node);
  }, []);
  return [ref, width];
}

/** The gutter the amounts are written in, left of the drawing, and the foot the months are named in. */
const GUTTER = 46;
const FOOT = 20;
const TOP = 12;

/** One month of the drawing: its month (`2026-11`), the figure, and what it is made of for the bars. */
export interface DeskChartMonth {
  month: string;
  netWorthMinor: number | null;
  /** What the month is made of, for the bars (its label is the chart's own). */
  bar: Omit<BarMonth, 'label'>;
}

const monthWord = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
/** A month along the foot: its name, and the year's two digits where the year changes from the month named before it. */
const footLabel = (month: string, before: string | undefined, years: boolean) => (years && (before === undefined || before.slice(0, 4) !== month.slice(0, 4)) ? `${monthWord(month)} ${month.slice(2, 4)}` : monthWord(month));
/** A month as the reading names it: the month and the year. */
const readingLabel = (month: string) => `${monthWord(month)} ${month.slice(0, 4)}`;

/**
 * Net worth over the months on the Mac page: the line with a soft fill, or the phone's stacks, at the box's own width
 * with the amounts written in a gutter on the left and the months along the foot (a desk has room for an axis, which
 * the phone's full-bleed drawing gives up). Passing over it reads a month, as a tap does on the phone; the arrows walk
 * the months. The series is the phone's own (`useNetWorthSeries`), so the two draw the same figures.
 */
export function DeskNetWorthChart({ months, view, currency, keys, height }: { months: readonly DeskChartMonth[]; view: 'line' | 'bars'; currency: string; keys: readonly StackKey[]; height: number }) {
  const [box, width] = useBoxWidth<HTMLDivElement>();
  return (
    <div ref={box} className="w-full" style={{ minHeight: height }}>
      {width > 0 && months.length > 0 && (view === 'line' ? <Line months={months} width={width} height={height} currency={currency} /> : <Bars months={months} width={width} height={height} currency={currency} keys={keys} />)}
    </div>
  );
}

function Foot({ months, xs, height, room }: { months: readonly DeskChartMonth[]; xs: readonly number[]; height: number; room: number }) {
  const years = months[0]?.month.slice(0, 4) !== months.at(-1)?.month.slice(0, 4);
  return (
    <g aria-hidden>
      {monthTicks(months.length, room).map((index, at, ticks) => (
        <text key={months[index]!.month} x={xs[index]} y={height - 5} textAnchor="middle" fontSize={10} fill="var(--ph-ink-3)">
          {footLabel(months[index]!.month, at === 0 ? undefined : months[ticks[at - 1]!]!.month, years)}
        </text>
      ))}
    </g>
  );
}

function Line({ months, width, height, currency }: { months: readonly DeskChartMonth[]; width: number; height: number; currency: string }) {
  const id = useId();
  const values = months.map((month) => month.netWorthMinor);
  const negative = values.some((value) => value !== null && value < 0);
  const chart = chartGeometry(
    values,
    months.map((month) => readingLabel(month.month)),
    { width, height, left: GUTTER, right: 10, top: TOP, bottom: FOOT, throughZero: negative, fillTo: negative ? 'zero' : 'floor' },
  );
  const { reading, svgProps } = useChartReading(chart.points, chart.width, { hover: true, label: 'Net worth by month. Pass over a month to read it, or use the arrow keys.' });
  const xs = months.map((_, index) => (months.length === 1 ? GUTTER : GUTTER + (index * (width - GUTTER - 10)) / (months.length - 1)));
  const above = `${id}-above`;
  const below = `${id}-below`;
  const fill = `${id}-fill`;
  return (
    <>
      <svg data-testid="net-worth-line-view" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...svgProps} className={`block ${svgProps.className}`}>
        <defs>
          <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ph-up)" stopOpacity={0.2} />
            <stop offset="1" stopColor="var(--ph-up)" stopOpacity={0} />
          </linearGradient>
          <clipPath id={above}>
            <rect x={0} y={0} width={width} height={Math.max(0, chart.zeroY)} />
          </clipPath>
          <clipPath id={below}>
            <rect x={0} y={chart.zeroY} width={width} height={Math.max(0, height - chart.zeroY)} />
          </clipPath>
        </defs>
        <g aria-hidden>
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={GUTTER} x2={chart.plotRight} y1={tick.y} y2={tick.y} stroke="var(--ph-hair)" strokeWidth={1} />
              <text x={GUTTER - 6} y={tick.y + 3.5} textAnchor="end" fontSize={10} fill="var(--ph-ink-3)">
                {shortMoney(tick.value, currency)}
              </text>
            </g>
          ))}
        </g>
        {[
          { clip: above, colour: 'var(--ph-up)', wash: `url(#${fill})` },
          { clip: below, colour: 'var(--ph-alarm)', wash: 'var(--ph-alarm)' },
        ].map((half) => (
          <g key={half.clip} clipPath={`url(#${half.clip})`}>
            {chart.areas.map((area, index) => (
              <path key={`area-${index}`} d={area} fill={half.wash} fillOpacity={half.clip === below ? 0.14 : 1} stroke="none" />
            ))}
            {chart.runs.map((run, index) => (
              <polyline key={`run-${index}`} data-testid="net-worth-line" points={run} fill="none" stroke={half.colour} strokeWidth={2.2} strokeLinejoin="round" />
            ))}
          </g>
        ))}
        {chart.last && <circle cx={chart.last.x} cy={chart.last.y} r={4} fill={chart.last.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-up)'} />}
        <Foot months={months} xs={xs} height={height} room={width - GUTTER} />
        <rect data-testid="net-worth-plot" x={GUTTER} y={0} width={Math.max(0, width - GUTTER)} height={height} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={chart.width} />}
      </svg>
      <ChartAnnouncement point={reading} currency={currency} />
    </>
  );
}

function Bars({ months, width, height, currency, keys }: { months: readonly DeskChartMonth[]; width: number; height: number; currency: string; keys: readonly StackKey[] }) {
  const KEY_ROW = 34;
  const drawn = height - KEY_ROW;
  const chart = barGeometry(
    months.map((month) => ({ ...month.bar, label: readingLabel(month.month) })),
    { width, height: drawn, left: 8, right: 8, top: TOP, bottom: FOOT, barWidth: 30 },
  );
  const { reading, svgProps } = useChartReading(chart.points, chart.width, { hover: true, label: 'Net worth by month, as what it is made of. Pass over a month to read it, or use the arrow keys.' });
  const pitch = months.length === 0 ? 0 : (width - 16) / months.length;
  const xs = months.map((_, index) => 8 + index * pitch + pitch / 2);
  const held = new Set(months.flatMap((month) => [...month.bar.assets, ...month.bar.liabilities]).flatMap((slice) => (slice.minor !== 0 ? [slice.key] : [])));
  const fillOf = new Map(keys.map((entry) => [entry.key, entry.fill]));
  return (
    <>
      <svg data-testid="net-worth-bars" width={width} height={drawn} viewBox={`0 0 ${width} ${drawn}`} {...svgProps} className={`block ${svgProps.className}`}>
        <g aria-hidden>
          {chart.ticks.map((tick) => (
            <line key={`t${tick.value}`} x1={0} x2={width} y1={tick.y} y2={tick.y} stroke="var(--ph-hair)" strokeWidth={1} strokeDasharray="1 4" />
          ))}
          <line x1={0} x2={width} y1={chart.zeroY} y2={chart.zeroY} stroke="var(--ph-hair)" strokeWidth={1} />
          {chart.rects.map((rect, index) => (
            <rect key={`${rect.key}-${index}`} data-key={rect.key} x={rect.x} y={rect.y} width={rect.width} height={rect.height} className={fillOf.get(rect.key)} />
          ))}
          {chart.runs.map((run, index) => (
            <polyline key={`run-${index}`} data-testid="net-worth-bar-line" points={run} fill="none" stroke="var(--ph-ink)" strokeWidth={1.5} strokeDasharray="3 3" strokeOpacity={0.55} />
          ))}
          {chart.points.map((point, index) =>
            point === null ? null : <circle key={`dot-${index}`} cx={point.x} cy={point.y} r={3} fill={point.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-up)'} stroke="var(--ph-surface)" strokeWidth={1.5} />,
          )}
        </g>
        <Foot months={months} xs={xs} height={drawn} room={width - 16} />
        <rect data-testid="net-worth-plot" x={0} y={0} width={width} height={drawn} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={chart.width} />}
      </svg>
      <ChartAnnouncement point={reading} currency={currency} />
      {/* The key names only what is drawn, as the phone's does. */}
      <div aria-hidden data-testid="net-worth-bars-key" className="flex h-[34px] flex-wrap content-start items-center gap-x-[12px] gap-y-[2px] overflow-hidden pt-[2px] text-[11px] text-[var(--ph-ink-3)]">
        {keys
          .filter((entry) => held.has(entry.key))
          .map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-[4px] whitespace-nowrap">
              <i className={`inline-block h-[9px] w-[9px] rounded-[2px] ${entry.className}`} />
              {entry.label}
            </span>
          ))}
      </div>
    </>
  );
}
