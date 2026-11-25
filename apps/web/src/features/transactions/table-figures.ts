import { formatMinor, parseLooseAmount } from '@expanses/core';

/*
 * What the Mac tables add up (owner 2026-11-25, as Google Sheets and Notion): the Amount cells picked — "3 cells · Sum
 * Rp 286.500 · Average Rp 95.500" — and every row the table shows, under the Amount column. One rule for both: each row
 * counts what its Amount cell shows, spending up and money in down (a grey row, left out of the figures, counts
 * nothing), and figures in more than one currency make no sum.
 */

/** One row's figure: positive for spending, negative for money in, in `currency`'s minor units. */
export interface Figure {
  minor: number;
  currency: string;
}

/** A capture's figure as its Amount cell shows it, in its own currency: money in below zero. */
export const draftFigure = (draft: { amountMinor: number; currency: string; kind?: string }): Figure => ({
  minor: draft.kind === 'income' ? -Math.abs(draft.amountMinor) : draft.amountMinor,
  currency: draft.currency,
});

/** A sum of figures, or why there is none (several currencies). */
export type FigureSum = { count: number; minor: number; currency: string } | { count: number; mixed: true };

/** The figures added up: their count, and their sum when they are all in one currency. */
export function sumFigures(figures: readonly Figure[], fallbackCurrency: string): FigureSum {
  const counted = figures.filter((figure) => figure.minor !== 0);
  const currency = counted[0]?.currency ?? figures[0]?.currency ?? fallbackCurrency;
  if (counted.some((figure) => figure.currency !== currency)) return { count: figures.length, mixed: true };
  return { count: figures.length, minor: counted.reduce((sum, figure) => sum + figure.minor, 0), currency };
}

/** A figure as the Amount column says it: spending plain, money in with a "+". */
export function figureText(minor: number, currency: string): string {
  return minor < 0 ? `+${formatMinor(-minor, currency)}` : formatMinor(minor, currency);
}

/** "3 cells · Sum Rp 286.500 · Average Rp 95.500" (Average rounded to the currency's smallest unit). */
export function sumLine(sum: FigureSum): string {
  const cells = `${sum.count} ${sum.count === 1 ? 'cell' : 'cells'}`;
  if ('mixed' in sum) return `${cells} · several currencies, no sum`;
  const average = sum.count > 0 ? Math.round(sum.minor / sum.count) : 0;
  return `${cells} · Sum ${figureText(sum.minor, sum.currency)} · Average ${figureText(average, sum.currency)}`;
}

/** The foot of the table: "6 shown", and the total of those rows (none with several currencies). */
export function totalFoot(sum: FigureSum): { shown: string; total: string | null } {
  return { shown: `${sum.count} shown`, total: 'mixed' in sum ? null : figureText(sum.minor, sum.currency) };
}

/**
 * The Amount header's filter (owner 2026-11-25): Over or Under a figure, typed in words as a cell takes it. Each row is
 * read against what its Amount cell shows (without its sign), in its own currency.
 */
export interface AmountFilter {
  over: string;
  under: string;
}

export const NO_AMOUNT_FILTER: AmountFilter = { over: '', under: '' };

export const amountFilterOn = (filter: AmountFilter) => filter.over.trim() !== '' || filter.under.trim() !== '';

/** Whether a row's shown amount (`minor`, without its sign) is over and under what the filter holds; a bound not read is no bound. */
export function withinAmount(minor: number, currency: string, filter: AmountFilter): boolean {
  const shown = Math.abs(minor);
  const over = filter.over.trim() ? parseLooseAmount(filter.over, currency) : null;
  const under = filter.under.trim() ? parseLooseAmount(filter.under, currency) : null;
  if (over !== null && !(shown > over)) return false;
  if (under !== null && !(shown < under)) return false;
  return true;
}

/** The Amount header while its filter is on: "Over Rp 50.000", "Under Rp 100.000", or both. */
export function amountFilterText(filter: AmountFilter, currency: string): string {
  const read = (text: string) => {
    const minor = text.trim() ? parseLooseAmount(text, currency) : null;
    return minor === null ? text.trim() : formatMinor(minor, currency);
  };
  return [filter.over.trim() && `Over ${read(filter.over)}`, filter.under.trim() && `Under ${read(filter.under)}`].filter(Boolean).join(' · ');
}
