import { coveredCharge } from './fee-date';
import { type FeeWaiver, type WaiverWindow, waiverWindow } from './spend-bonus';

/*
 * One fee year on the Fee waiver page (owner, 13 Nov 2026): what the card's own transactions say about that year's
 * annual fee, read as the lines the page shows and the one word Settings shows.
 */

/** What is recorded for one fee year. */
export interface FeeYearFacts {
  /** The fee charge is on the card. */
  charged: boolean;
  /** The charge date is before the card's counted-from day and no charge is recorded: it is in the starting balance. */
  beforeApp: boolean;
  /** Money back for the fee is on the card. */
  reversed: boolean;
  /** The year is marked waived (card_terms.annual_fee_waived_year). */
  marked: boolean;
}

export type FeeYearLine = 'pending' | 'charged' | 'charged-before-app' | 'reversal' | 'waived';
export type FeeYearState = 'pending' | 'charged' | 'waived';

/**
 * The lines a fee year shows, top first: the charge (or that it was charged before the app, once a reversal says so),
 * then the reversal; with no charge, Waived when the year is marked, else Pending. A reversal is never promised before
 * it is on the card.
 */
export function feeYearLines(facts: FeeYearFacts): FeeYearLine[] {
  const reversal: FeeYearLine[] = facts.reversed ? ['reversal'] : [];
  if (facts.charged) return ['charged', ...reversal];
  if (facts.beforeApp && facts.reversed) return ['charged-before-app', 'reversal'];
  if (facts.reversed) return ['reversal'];
  return [facts.marked ? 'waived' : 'pending'];
}

/** How the year stands: waived once money came back or the year is marked, charged with the charge alone, else pending. */
export function feeYearState(facts: FeeYearFacts): FeeYearState {
  if (facts.reversed || facts.marked) return 'waived';
  return facts.charged ? 'charged' : 'pending';
}

/** The same month and day in `year`; 29 Feb falls on 28 Feb in a year without one. */
function inYear(date: string, year: number): string {
  const month = date.slice(5, 7);
  let day = Number(date.slice(8, 10));
  if (month === '02' && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) day = 28;
  return `${String(year).padStart(4, '0')}-${month}-${String(day).padStart(2, '0')}`;
}

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The days Progress counts over, and the fee year it counts toward. A yearly amount counts the 12 months up to the fee
 * the page covers while that fee is open; once it is settled (waived or charged) it counts toward the next one. A
 * challenge counts over its own days. With no fee date, a yearly amount counts the last 12 months and names no year.
 */
export function feeProgressWindow(waiver: FeeWaiver, feeOn: string | null, today: string, settled: boolean): WaiverWindow & { feeYear: number | null } {
  if (waiver.kind !== 'automatic' || !feeOn) return { ...waiverWindow(waiver, feeOn, today), feeYear: null };
  const coveredYear = Number(coveredCharge(feeOn, today).slice(0, 4));
  const feeYear = settled ? coveredYear + 1 : coveredYear;
  const to = inYear(feeOn, feeYear);
  return { from: shift(inYear(to, feeYear - 1), 1), to, feeYear };
}

/**
 * Settings' Fee waiver row: the covered year once it is settled ("2026 waived", "2026 charged"); else None without a
 * program, Free for life for a fee always waived, Reached with nothing left, or what is left ("Rp 18 jt to go").
 * `toGo` is what is left to spend as money, null when nothing is.
 *
 * A charged year with a bank's challenge (owner ruling, mockup section 5) follows the challenge while it runs or once
 * it is reached — the reversal is still to come — and reads charged only once it ended short.
 */
export function feeWaiverRowText(
  year: { year: number; state: FeeYearState } | null,
  waiver: FeeWaiver | null,
  toGo: string | null,
  today: string,
  challengeYear: number | null,
): string {
  // Only the covered year's own challenge: last year's, met and left on the card, says nothing about this fee.
  const ours = year !== null && challengeCoversFee(challengeYear, year.year);
  const challengeOpen = ours && waiver?.kind === 'challenge' && (toGo === null || (waiver.spendBy !== null && today <= waiver.spendBy));
  if (year && year.state === 'waived') return `${year.year} waived`;
  if (year && year.state === 'charged' && !challengeOpen) return `${year.year} charged`;
  if (!waiver) return 'None';
  if (waiver.kind === 'lifetime') return 'Free for life';
  return toGo === null ? 'Reached' : `${toGo} to go`;
}

/**
 * Whether a fee challenge is about the fee year a waiver covers now: the year kept on the challenge when it was saved
 * (the charge it was given for, even when given after the fee posted) is the covered charge's.
 */
export function challengeCoversFee(challengeYear: number | null, coveredYear: number): boolean {
  return challengeYear !== null && challengeYear === coveredYear;
}

/** How far before a fee date its charge may be dated, and after it (the statement after the anniversary). */
export const FEE_DAYS_BEFORE = 20;
export const FEE_DAYS_AFTER = 45;
/** How long after the fee date a bank's reversal of it is still looked for: the fee's own window and a cycle more. */
export const FEE_REVERSAL_DAYS_AFTER = 120;

/** What the Fee waiver page names the fee charge it adds, and the reversal it adds (owner, 13 Nov 2026). */
export const FEE_CHARGE_DESCRIPTION = 'Annual fee';
export const FEE_REVERSAL_DESCRIPTION = 'Annual fee reversal';

/**
 * The days a statement row may be dated and still be the fee charge or reversal the Fee waiver page added on `on`: the
 * window of the fee date that day belongs to. Only those two descriptions, each in its own direction (a charge out, a
 * reversal in), have one; anything else, or a day near no fee date, gets null.
 */
export function feeCandidateWindow(description: string, direction: 'out' | 'in', feeOn: string, on: string): WaiverWindow | null {
  const after = description === FEE_CHARGE_DESCRIPTION && direction === 'out' ? FEE_DAYS_AFTER : description === FEE_REVERSAL_DESCRIPTION && direction === 'in' ? FEE_REVERSAL_DAYS_AFTER : null;
  if (after === null) return null;
  const year = Number(on.slice(0, 4));
  for (const y of [year, year - 1, year + 1]) {
    const date = inYear(feeOn, y);
    const window = { from: shift(date, -FEE_DAYS_BEFORE), to: shift(date, after) };
    if (on >= window.from && on <= window.to) return window;
  }
  return null;
}
