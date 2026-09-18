import { isoDate } from '@expanses/core';
import { shortDate } from '../transactions/quick-row';

export interface UnconvertedRow {
  currency: string;
  onDate: string;
}

/** One list from several, each currency kept once, at the earliest day a rate was wanted for and not found. */
export function mergeUnconverted(...lists: readonly (readonly UnconvertedRow[])[]): UnconvertedRow[] {
  const earliest = new Map<string, string>();
  for (const list of lists) {
    for (const row of list) {
      const held = earliest.get(row.currency);
      if (!held || row.onDate < held) earliest.set(row.currency, row.onDate);
    }
  }
  return [...earliest].map(([currency, onDate]) => ({ currency, onDate })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * What a figure leaves out, said above it.
 *
 * A workspace that reads in its own currency converts each amount at the rate on its own day, and rates are kept
 * one way round: a workspace in dollars needs rupiah→dollar rows. Rather than guess at a day no rate reaches, the
 * amount is left out — so the screen has to say so, or the total would quietly be wrong.
 *
 * One banner to a screen: where the chart and the list are shown together they are the same missing rate said
 * twice, so the chart takes the list's list as well and the list leaves it to the chart.
 */
export function Unconverted({ missing, currency }: { missing: readonly UnconvertedRow[]; currency: string }) {
  if (missing.length === 0) return null;
  const one = missing.length === 1;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="unconverted">
      {missing.length} amount{one ? '' : 's'} in {missing.map((m) => m.currency).join(', ')} {one ? 'is' : 'are'} not counted: no{' '}
      {missing[0]!.currency}→{currency} rate for {shortDate(missing[0]!.onDate, isoDate())} or earlier. Use Add transaction to enter one.
    </p>
  );
}
