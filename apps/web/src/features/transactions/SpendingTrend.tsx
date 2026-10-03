import { isoDate, parsePeriod, spendingComparisons, spendingTrend, type TrendBar, type TrendComparison, type TrendUnit, trendWindow, weekOf } from '@expanses/core';
import { dailyTotalsIn, firstTransactionDate } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { cx, Money } from '../../ui';
import { ChartAnnouncement, ChartReading, READING_ROOM, useChartReading } from '../networth/chart-reading';
import type { ChartPoint } from '../networth/value-chart';

/** The donut's own box, so turning the card from the ring to the bars never moves the list under it. */
const WIDTH = 400;
const HEIGHT = 290;
const TICK_ROOM = 22;

/**
 * The spending a period is made of, over time: its bars, and the line of comparisons under them.
 *
 * One read of the days covers both — the comparisons reach back further than the bars, so the window is theirs.
 */
export function useSpendingTrend(month: string, kind: 'expense' | 'income', excludeEvents: boolean) {
  const { database, ws } = useApp();
  const today = isoDate();
  const first = useQuery({ queryKey: ['first-transaction', ws.workspaceId], queryFn: () => firstTransactionDate(database, ws) });
  const period = parsePeriod(month);
  const ctx = { today, first: first.data ?? null };
  const window = period && first.isSuccess ? trendWindow(period, ctx) : null;
  const daily = useQuery({
    queryKey: ['daily-totals', ws.workspaceId, ws.bookId ?? null, kind, window?.from, window?.to, excludeEvents ? 'without-events' : 'with-events'],
    enabled: window !== null,
    queryFn: () => dailyTotalsIn(database, ws, kind, window!.from, window!.to, { excludeEvents, billMonths: true }),
  });
  if (!period || !daily.data) return null;
  return {
    ...spendingTrend(period, daily.data.days, ctx),
    comparisons: spendingComparisons(period, daily.data.days, ctx),
    currency: daily.data.currency,
  };
}

/** The period a bar stands for, for the picker to move to: one day, its week, its month, its year. */
export function periodOfBar(unit: TrendUnit, bar: TrendBar): string {
  switch (unit) {
    case 'day':
      return `${bar.from}..${bar.from}`;
    case 'week':
      return weekOf(bar.from);
    case 'month':
      return bar.from.slice(0, 7);
    case 'year':
      return bar.from.slice(0, 4);
  }
}

/** How many ticks fit under the bars without running into each other. */
function tickEvery(unit: TrendUnit, count: number): number {
  if (unit === 'day' && count > 7) return 7;
  // Twelve three-letter months fit a phone's width; past a year, every third does.
  if (unit === 'month') return count > 12 ? 3 : 1;
  return Math.max(1, Math.ceil(count / 8));
}

/**
 * The bars, with nothing written on them.
 *
 * Read the way the net worth line is read: a tap picks the bar under it and its total is written in a pill above it,
 * dragging moves the reading along, and Escape lets go. Thirty figures printed over thirty bars would be none of them
 * legible. The biggest bar is drawn in the warning colour, the one still under way faint, and one yet to come not at all.
 */
export function TrendBars({ bars, unit, currency }: { bars: readonly TrendBar[]; unit: TrendUnit; currency: string }) {
  const base = HEIGHT - TICK_ROOM;
  const top = READING_ROOM;
  const step = WIDTH / Math.max(1, bars.length);
  const gap = bars.length > 20 ? 3 : step * 0.28;
  const width = step - gap;
  const peak = Math.max(0, ...bars.map((bar) => bar.totalMinor ?? 0));
  const peakAt = peak > 0 ? bars.findIndex((bar) => bar.totalMinor === peak) : -1;
  const height = (minor: number) => (peak > 0 ? Math.max(minor > 0 ? 2 : 0, (minor / peak) * (base - top)) : 0);
  const points: (ChartPoint | null)[] = bars.map((bar, index) =>
    bar.totalMinor === null ? null : { x: index * step + step / 2, y: base - height(bar.totalMinor), value: bar.totalMinor, label: bar.partial ? `${bar.label} so far` : bar.label },
  );
  const { reading, svgProps } = useChartReading(points, WIDTH, { label: `Spending by ${unit}. Tap a bar to read it, or use the arrow keys.`, hover: true });
  const picked = reading ? points.indexOf(reading) : -1;
  const every = tickEvery(unit, bars.length);

  return (
    // The card under it folds its categories on a tap; a tap here is a reading, so it stops before it gets there.
    // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the tap from reaching the card behind
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} data-testid="trend-bars">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} {...svgProps} className={`block h-auto w-full ${svgProps.className}`}>
        {bars.map((bar, index) =>
          bar.totalMinor === null ? null : (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: the bars are positional
              key={index}
              data-testid="trend-bar"
              x={index * step + gap / 2}
              y={base - height(bar.totalMinor)}
              width={width}
              height={height(bar.totalMinor)}
              rx={Math.min(4, width / 3)}
              fill={index === peakAt ? 'var(--ph-warn)' : 'var(--ph-tint)'}
              fillOpacity={(index === peakAt ? 1 : bar.partial ? 0.3 : 0.6) * (picked >= 0 && picked !== index ? 0.45 : 1)}
            />
          ),
        )}
        <line x1={0} x2={WIDTH} y1={base} y2={base} stroke="var(--ph-hair)" strokeWidth={1} />
        {bars.map((bar, index) =>
          index % every ? null : (
            // biome-ignore lint/suspicious/noArrayIndexKey: the ticks are positional
            <text key={index} x={Math.min(Math.max(index * step + step / 2, 14), WIDTH - 14)} y={HEIGHT - 6} textAnchor="middle" fontSize={12} fill="var(--ph-ink-3)">
              {bar.tick}
            </text>
          ),
        )}
        {/* The whole drawing is the target, not a bar's own few pixels: a thumb is wider than a day. */}
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={WIDTH} />}
      </svg>
      <ChartAnnouncement point={reading} currency={currency} />
    </div>
  );
}

/**
 * Under the bars: how the period stands against the ones around it, then its biggest days, weeks or months.
 *
 * Both are one line apiece. What drove a day is one tap away in the transaction list, and the share of the whole is
 * the donut's to say. A rise is red for money going out and green for money coming in.
 */
export function TrendUnder({
  bars,
  unit,
  comparisons,
  kind,
  currency,
  onPeriod,
}: {
  bars: readonly TrendBar[];
  unit: TrendUnit;
  comparisons: readonly TrendComparison[];
  kind: 'expense' | 'income';
  currency: string;
  onPeriod?: (period: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const ranked = bars
    .map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => (bar.totalMinor ?? 0) > 0)
    .sort((a, b) => b.bar.totalMinor! - a.bar.totalMinor! || a.index - b.index);
  const few = unit === 'day' && bars.length > 7 ? 5 : 3;
  const shown = showAll ? ranked : ranked.slice(0, few);
  const plural = { day: 'days', week: 'weeks', month: 'months', year: 'years' }[unit];

  return (
    <div className="mt-2 border-t border-slate-100" data-testid="trend-under">
      {comparisons.length > 0 && (
        <div className="grid auto-cols-fr grid-flow-col border-b border-slate-100 py-2.5" data-testid="trend-comparisons">
          {comparisons.map((comparison) => {
            const good = kind === 'expense' ? comparison.changePercent < 0 : comparison.changePercent > 0;
            const tone = comparison.changePercent === 0 ? 'text-[var(--ph-ink-3)]' : good ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-alarm)]';
            const figure = `${comparison.changePercent > 0 ? '▲' : comparison.changePercent < 0 ? '▼' : ''} ${Math.abs(comparison.changePercent)}%`.trim();
            const content = (
              <>
                <span className={cx('tabular block text-[15px] font-semibold', tone)}>{figure}</span>
                <span className="block text-[11px] text-[var(--ph-ink-3)]">vs {comparison.label}</span>
              </>
            );
            const cell = 'min-w-0 px-1 text-center [&+*]:border-l [&+*]:border-slate-100';
            return comparison.period && onPeriod ? (
              <button key={comparison.key} type="button" className={cell} onClick={() => onPeriod(comparison.period!)} data-testid="trend-comparison">
                {content}
              </button>
            ) : (
              <div key={comparison.key} className={cell} data-testid="trend-comparison">
                {content}
              </div>
            );
          })}
        </div>
      )}
      {ranked.length > 0 && (
        <>
          <h3 className="mt-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--ph-ink-3)]">Biggest {plural}</h3>
          <div className="divide-y divide-slate-100">
            {shown.map(({ bar }, place) => (
              <button
                key={bar.from}
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[15px] last:min-h-0 last:pb-0"
                onClick={onPeriod ? () => onPeriod(periodOfBar(unit, bar)) : undefined}
                data-testid="trend-biggest"
              >
                <span className="min-w-0 truncate">{bar.partial ? `${bar.label} so far` : bar.label}</span>
                <Money minor={bar.totalMinor!} currency={currency} className={cx('font-semibold', place === 0 && 'text-[var(--ph-warn)]')} />
              </button>
            ))}
          </div>
          {ranked.length > few && (
            <button type="button" className="mt-1 w-full py-2 text-center text-sm font-semibold text-[var(--ph-tint)]" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${plural}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
