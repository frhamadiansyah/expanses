import { formatMinor, isoDate, PRICE_SCALE } from '@expanses/core';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import type { GoldDay } from '../../lib/fx-client';
import { InsetGroup, Panel, ReadOnlyRow, SegmentedControl } from '../../ui/native';
import { useShownWidth } from '../accounts/BalanceSpark';
import { dayLabel } from './asset-page';
import { ChartAnnouncement, ChartReading, useChartReading } from './chart-reading';
import { averageBoughtAt, dayFraction, GOLD_RANGES, type GoldDot, goldDots, type GoldRange, rangeStart } from './gold-chart';
import { useWorldGoldSeries } from './world-gold';

/** A price a gram in whole minor units, as the gold sheets write it: Rp 1.950.000/g. */
const perGram = (minor: number, currency: string) => `${formatMinor(Math.round(minor), currency)}/g`;

/** The drawing's height, and the room either side of it so a dot on an end is drawn whole. */
const PLOT_HEIGHT = 150;
const EDGE = 6;

/**
 * Gold's Chart: the world price of a gram over a month, six months, a year or five, with this holding's buys and sells
 * drawn on it where they happened at what they paid or fetched a gram — so a buy reads against the market it was
 * made in. Under it, the holding's own price now and what its grams cost on average.
 *
 * The line is the world spot price, the same open service the page's own World price comes from; a dealer's price sits
 * a few percent off it, which is why a dot is rarely on the line.
 */
export function GoldChartSheet({
  currency,
  trades,
  latest,
  costMinor,
  unitsMicro,
  onClose,
}: {
  currency: string;
  trades: readonly { id: string; kind: string; occurredOn: string; unitsMicro: number; grossMinor: number }[];
  /** The holding's current price a gram and its day, as the page shows it. */
  latest: { priceMicro: number; onDate: string } | null;
  costMinor: number;
  unitsMicro: number;
  onClose: () => void;
}) {
  const [range, setRange] = useState<GoldRange>('1Y');
  const today = isoDate();
  const from = rangeStart(range, today);
  const series = useWorldGoldSeries(currency, from, today);
  const dots = goldDots(trades, from, today);
  const average = averageBoughtAt(costMinor, unitsMicro);
  const ago = GOLD_RANGES.find((row) => row.key === range)!.ago;

  return (
    <Sheet grouped title="Price per gram" onClose={onClose}>
      <div className="flex flex-col gap-[14px]">
        <SegmentedControl label="Range" segments={GOLD_RANGES.map((row) => ({ key: row.key, label: row.key }))} value={range} onChange={(key) => setRange(key as GoldRange)} />
        <Panel testId="gold-chart">
          {series.isPending ? (
            <p className="flex items-center justify-center text-[13px] text-[var(--ph-ink-3)]" style={{ height: PLOT_HEIGHT }}>
              Loading…
            </p>
          ) : series.isError ? (
            <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="gold-chart-note">
              {/* A refusal or an empty answer is the service's; anything else never reached it. */}
              {String(series.error).includes('Frankfurter') || String(series.error).includes('No world gold') ? `No world price in ${currency} for this range.` : 'The price history needs a connection.'}
            </p>
          ) : series.data.length === 0 ? (
            <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]" data-testid="gold-chart-note">
              No world price in {currency} for this range.
            </p>
          ) : (
            <>
              <GoldLine series={series.data} dots={dots} from={from} to={today} currency={currency} />
              <div className="mt-[2px] flex justify-between text-[11px] leading-[14px] text-[var(--ph-ink-3)]">
                <span>{ago}</span>
                <span>today</span>
              </div>
              <div className="mt-[10px] flex items-center justify-between gap-3 border-t-[1px] border-dashed border-[var(--ph-hair)] pt-[10px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
                <span data-testid="gold-chart-legend">
                  <span aria-hidden className="text-[var(--ph-up)]">●</span> bought · <span aria-hidden className="text-[var(--ph-alarm)]">●</span> sold
                </span>
                <span>World gold price</span>
              </div>
            </>
          )}
        </Panel>
        {(latest || average !== null) && (
          <InsetGroup>
            {latest ? <ReadOnlyRow label={`Now · ${dayLabel(latest.onDate)}`} value={perGram(latest.priceMicro / PRICE_SCALE, currency)} /> : null}
            {average !== null ? <ReadOnlyRow label="Average bought at" value={perGram(average / PRICE_SCALE, currency)} /> : null}
          </InsetGroup>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The world price as one line, laid out by the calendar so a trade sits on its own day, with a dot for each buy (the
 * tint) and sell (alarm) at its price a gram. Read a day at a time by touching it, as the page's own line is.
 */
function GoldLine({ series, dots, from, to, currency }: { series: readonly GoldDay[]; dots: readonly GoldDot[]; from: string; to: string; currency: string }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const width = useShownWidth(box) ?? 300;
  const figures = [...series.map((day) => day.minor), ...dots.map((dot) => dot.minor)];
  const high = Math.max(...figures);
  const low = Math.min(...figures);
  // A flat stretch sits in the middle rather than on an edge, as the page's line does off zero.
  const pad = high === low ? Math.max(1, Math.abs(high) * 0.05) : (high - low) * 0.1;
  const top = high + pad;
  const span = top - (low - pad);
  const x = (on: string) => EDGE + dayFraction(on, from, to) * (width - EDGE * 2);
  const y = (minor: number) => EDGE + ((top - minor) / span) * (PLOT_HEIGHT - EDGE * 2);
  const points = series.map((day) => ({ x: x(day.on), y: y(day.minor), value: Math.round(day.minor), label: dayLabel(day.on) }));
  const { reading, svgProps } = useChartReading(points, width, { label: 'World gold price per gram. Tap a day to read it, or use the arrow keys.', hover: true });
  const last = points.at(-1)!;

  return (
    <div ref={setBox}>
      <svg width="100%" viewBox={`0 0 ${width} ${PLOT_HEIGHT}`} {...svgProps} className={`overflow-visible ${svgProps.className}`} data-testid="gold-line">
        <polyline
          fill="none"
          stroke="var(--ph-ink-2)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        />
        <circle cx={last.x} cy={last.y} r="3" fill="var(--ph-ink-2)" />
        {dots.map((dot) => (
          <circle
            key={dot.id}
            cx={x(dot.on)}
            cy={y(dot.minor)}
            r="4.5"
            fill={dot.kind === 'buy' ? 'var(--ph-up)' : 'var(--ph-alarm)'}
            stroke="var(--ph-surface)"
            strokeWidth="1.5"
            data-testid="gold-dot"
            data-kind={dot.kind}
          >
            <title>{`${dot.kind === 'buy' ? 'Bought' : 'Sold'} · ${dayLabel(dot.on)} · ${perGram(dot.minor, currency)}`}</title>
          </circle>
        ))}
        {/* The whole drawing is the target: a thumb is wider than the line. */}
        <rect x={0} y={0} width={width} height={PLOT_HEIGHT} fill="transparent" />
        {reading && <ChartReading point={reading} currency={currency} width={width} />}
      </svg>
      <ChartAnnouncement point={reading} currency={currency} />
    </div>
  );
}
