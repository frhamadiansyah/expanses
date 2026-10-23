import { addMonthsToDate, PRICE_SCALE, priceMicroFrom } from '@expanses/core';

/**
 * Gold's Chart sheet, the parts that are only arithmetic: how far back each range reaches, where this holding's buys
 * and sells sit on the world price line, and what its grams cost on average.
 */

export type GoldRange = '1M' | '6M' | '1Y' | '5Y';

/** The ranges in the order the control shows them, with how far back each reaches and the words under its start. */
export const GOLD_RANGES: readonly { key: GoldRange; months: number; ago: string }[] = [
  { key: '1M', months: 1, ago: '1 month ago' },
  { key: '6M', months: 6, ago: '6 months ago' },
  { key: '1Y', months: 12, ago: '1 year ago' },
  { key: '5Y', months: 60, ago: '5 years ago' },
];

/** The first day a range covers, ending on `today`: the same day of the month, that many months back. */
export function rangeStart(range: GoldRange, today: string): string {
  const months = GOLD_RANGES.find((row) => row.key === range)!.months;
  return addMonthsToDate(today, -months);
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/** How far across `from`…`to` a day sits, 0 at the start and 1 at the end: the chart is laid out by the calendar. */
export function dayFraction(on: string, from: string, to: string): number {
  const span = dayNumber(to) - dayNumber(from);
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (dayNumber(on) - dayNumber(from)) / span));
}

/** A buy or a sell drawn on the line: its day, and what it paid or fetched a gram, in minor units. */
export interface GoldDot {
  id: string;
  kind: 'buy' | 'sell';
  on: string;
  /** Price per gram in the currency's minor units, as the line's own figures are. */
  minor: number;
}

/**
 * The holding's buys and sells inside `from`…`to`, each at its price per gram — the gross over the grams, what the
 * receipt says before fees — oldest first. A trade with no grams (an income, a unit change) has no price to draw.
 */
export function goldDots(
  trades: readonly { id: string; kind: string; occurredOn: string; unitsMicro: number; grossMinor: number }[],
  from: string,
  to: string,
): GoldDot[] {
  return trades
    .filter((row): row is typeof row & { kind: 'buy' | 'sell' } => (row.kind === 'buy' || row.kind === 'sell') && row.unitsMicro > 0 && row.grossMinor > 0)
    .filter((row) => row.occurredOn >= from && row.occurredOn <= to)
    .map((row) => ({ id: row.id, kind: row.kind, on: row.occurredOn, minor: priceMicroFrom(row.grossMinor, row.unitsMicro) / PRICE_SCALE }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/** What the grams held cost on average, a gram (millionths of a minor unit, as a price is); null when none are held. */
export function averageBoughtAt(costMinor: number, unitsMicro: number): number | null {
  return unitsMicro > 0 ? priceMicroFrom(costMinor, unitsMicro) : null;
}
