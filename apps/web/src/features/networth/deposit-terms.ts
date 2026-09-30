import { daysFrom, depositInterest, parseRate, termStart, type TermMonths } from '@expanses/core';

/**
 * What a time deposit's terms read as, in one line.
 *
 * The maturity and the rate are asked for when the deposit is opened, and until now nothing ever said them
 * back. They are the two facts that make a deposit a deposit — the day the money comes back, and what it pays
 * for waiting — so the account's own page prints them, and so does its row on Accounts.
 */

/** The day in the words a date is said in — "1 Mar 2027", not "2027-03-01". */
export function maturityLabel(maturesOn: string): string {
  const date = new Date(`${maturesOn}T00:00:00`);
  if (Number.isNaN(date.getTime())) return maturesOn;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A rate held in basis points, said the way the form asks for it: 625 is "6,25%". */
export const rateLabel = (rateBps: number): string => `${(rateBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

/** A term in months, said the way a person says it: 3 is "3 months", 1 is "1 month". */
export const termLabel = (months: number): string => `${months} ${months === 1 ? 'month' : 'months'}`;

/**
 * The deposit's facts in the order a deposit is read in, under its figure: what it pays, for how long, and the
 * day the money comes back — "4,25% · 3 months · matures 15 Oct 2026". A rate of zero is left off.
 */
export function depositHeroLine(terms: { maturesOn: string; rateBps: number }, termMonths: number): string {
  const parts = [terms.rateBps > 0 ? rateLabel(terms.rateBps) : null, termLabel(termMonths), `matures ${maturityLabel(terms.maturesOn)}`];
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/** The short line for a deposit. A rate of zero is left off: nobody typed one, so there is nothing to say. */
export function depositLine(terms: { maturesOn: string; rateBps: number }): string {
  const matures = `Matures ${maturityLabel(terms.maturesOn)}`;
  return terms.rateBps > 0 ? `${matures} · ${rateLabel(terms.rateBps)}` : matures;
}

/** Basis points back into the percent a form asks for, with the comma its placeholder shows: 425 is "4,25"; 0 is empty. */
export const rateInputText = (rateBps: number): string => (rateBps === 0 ? '' : String(rateBps / 100).replace('.', ','));

/** A typed percent into basis points, read by `parseRate`: "4,25" is 425, "12,5" is 1250. */
export const rateBpsFrom = (text: string): number => Math.round(parseRate(text) * 100);

export interface MaturityProgress {
  /** How far through the term today is, 0 to 1: the bar on the deposit's card. */
  fraction: number;
  /** Days until the money comes back; 0 on the day and after it. */
  daysLeft: number;
  /** What the whole term pays on today's balance at the stored rate, before tax; 0 with no rate typed. */
  interestMinor: number;
}

/**
 * Where a deposit stands in its term: the bar from the day it started to the day it matures, the days left, and what
 * the term pays. The start is the core's `termStart` — the stored one after a roll-over, otherwise dated back from the
 * maturity by the term — so the bar and the maturity schedule never disagree about when this term began. The interest
 * is `depositInterest` over the whole term, the same actual/365 estimate a withdrawal proposes.
 */
export function maturityProgress(
  terms: { maturesOn: string; rateBps: number },
  term: { termMonths: TermMonths; termStartedOn: string | null },
  balanceMinor: number,
  today: string,
): MaturityProgress {
  const startsOn = termStart({ maturesOn: terms.maturesOn, termMonths: term.termMonths, termStartedOn: term.termStartedOn, interestPaid: 'at_maturity', enabledOn: '' });
  const length = daysFrom(startsOn, terms.maturesOn);
  const gone = daysFrom(startsOn, today);
  return {
    fraction: length <= 0 ? 1 : Math.min(1, Math.max(0, gone / length)),
    daysLeft: Math.max(0, daysFrom(today, terms.maturesOn)),
    interestMinor: depositInterest(balanceMinor, terms.rateBps, length),
  };
}

/** "12 days left", "1 day left", or "Matured" from the day itself. */
export const daysLeftLabel = (days: number): string => (days <= 0 ? 'Matured' : `${days} ${days === 1 ? 'day' : 'days'} left`);
