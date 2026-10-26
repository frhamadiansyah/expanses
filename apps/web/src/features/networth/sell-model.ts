import { parseMajor } from '@expanses/core';
import { saleFigures } from '@expanses/db';

/**
 * What the Sell sheet works out from what is typed, apart from the sheet: the figures of its totals box and the one
 * thing that stops Record sale. Pure, so a test can hold each sum and each refusal down.
 */

export interface SellDraft {
  /** Typed as the amount field shows it, in the asset's currency. */
  soldFor: string;
  /** YYYY-MM-DD, or '' while not chosen. */
  date: string;
  /** The money account the total is paid into, or '' while not chosen. */
  cashId: string;
  costs: string;
  goalId: string;
}

export interface SellFigures {
  soldForMinor: number | null;
  costsMinor: number;
  totalMinor: number | null;
  /** The total against the original cost; null until there is a total. */
  gainMinor: number | null;
  /** Why it cannot be recorded yet, in words for the screen; null when nothing is wrong. Blank fields are not wrong, only waiting. */
  problem: string | null;
  /** Everything needed is in and fits. */
  ready: boolean;
}

function amountOf(text: string, currency: string): number | null | 'bad' {
  if (text.trim() === '') return null;
  try {
    return parseMajor(text, currency);
  } catch {
    return 'bad';
  }
}

export function sellFigures(draft: SellDraft, o: { currency: string; costMinor: number; today: string; acquiredOn: string | null }): SellFigures {
  const sold = amountOf(draft.soldFor, o.currency);
  const costs = amountOf(draft.costs, o.currency);
  let problem: string | null = null;
  if (sold === 'bad') problem = 'Sold for must be a number';
  else if (costs === 'bad') problem = 'Costs must be a number';
  else if (sold !== null && sold <= 0) problem = 'Sold for must be more than zero';
  else if (costs !== null && costs < 0) problem = 'Costs cannot be below zero';
  else if (sold !== null && costs !== null && costs >= sold) problem = 'Costs must be less than what it sold for';
  else if (draft.date !== '' && draft.date > o.today) problem = 'It cannot be sold after today';
  else if (draft.date !== '' && o.acquiredOn && draft.date < o.acquiredOn) problem = 'It cannot be sold before it was acquired';
  const soldForMinor = typeof sold === 'number' && sold > 0 ? sold : null;
  const costsMinor = typeof costs === 'number' && costs > 0 ? costs : 0;
  const figures = soldForMinor !== null && problem === null ? saleFigures(soldForMinor, costsMinor, o.costMinor) : null;
  return {
    soldForMinor,
    costsMinor,
    totalMinor: figures?.totalMinor ?? null,
    gainMinor: figures?.gainMinor ?? null,
    problem,
    ready: figures !== null && draft.date !== '' && draft.cashId !== '',
  };
}

/** A gain with its sign, as the page writes one: +Rp 15.000.000, −Rp 2.000.000. */
export function signedGain(minor: number, format: (minor: number) => string): string {
  return `${minor < 0 ? '−' : '+'}${format(Math.abs(minor))}`;
}

/** How long something was held, between two days: "4 years 7 months", "9 months", "Under a month". */
export function heldFor(from: string, to: string): string {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return '';
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [years > 0 ? `${years} ${years === 1 ? 'year' : 'years'}` : '', rest > 0 ? `${rest} ${rest === 1 ? 'month' : 'months'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Under a month';
}
