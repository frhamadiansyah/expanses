import { daysFrom } from '../bills/schedule';
import { addMonths, daysInMonth } from '../reports/periods';

/**
 * A time deposit's maturity, worked out rather than stored.
 *
 * Nothing here posts or remembers anything. Given the terms, the automation settings, the events already confirmed
 * and today's date, it says what is due and what it comes to. Every figure is an estimate from the stored rate: the
 * owner confirms or corrects it against what the bank actually credited.
 */

export const TERM_MONTHS = [1, 3, 6, 12] as const;
export type TermMonths = (typeof TERM_MONTHS)[number];
export type MaturityChoice = 'principal' | 'principal_interest' | 'close';
export type InterestPaid = 'monthly' | 'at_maturity';

/** The withholding a new deposit starts with. An editable default, not a country rule: the user can change it per deposit. */
export const DEFAULT_TAX_BPS = 2_000;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The same day `months` later (or earlier), or that month's last day when it has no such day: 31 Jan + 1 is 28 Feb.
 * The month step is `addMonths`'s. The only thing added here is clamping the day.
 */
export function addMonthsToDate(date: string, months: number): string {
  const month = addMonths(date.slice(0, 7), months);
  const last = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  return `${month}-${pad(Math.min(Number(date.slice(8, 10)), last))}`;
}

/**
 * Interest for `days` days: actual/365, floored to the minor unit, in BigInt because principal × rate × days passes
 * 2^53 for a large deposit. A bank credits no fraction, so an estimate never promises more than arrives.
 */
export function depositInterest(principalMinor: number, rateBps: number, days: number): number {
  if (!Number.isSafeInteger(principalMinor) || principalMinor <= 0) return 0;
  if (!Number.isInteger(rateBps) || rateBps <= 0 || !Number.isInteger(days) || days <= 0) return 0;
  return Number((BigInt(principalMinor) * BigInt(rateBps) * BigInt(days)) / 3_650_000n);
}

/** The tax taken at source: floored, then subtracted, so gross = net + tax exactly. Nothing on a tax-free deposit. */
export function withholdTax(grossMinor: number, taxBps: number, exempt: boolean): { taxMinor: number; netMinor: number } {
  const taxMinor = exempt || grossMinor <= 0 ? 0 : Number((BigInt(grossMinor) * BigInt(taxBps)) / 10_000n);
  return { taxMinor, netMinor: grossMinor - taxMinor };
}

/** Whether anything lands outside the deposit. With principal + interest rolling over, nothing does. */
export const needsPayout = (choice: MaturityChoice): boolean => choice !== 'principal_interest';

export interface DepositSchedule {
  maturesOn: string;
  termMonths: TermMonths;
  /** Written by a confirmed roll-over; null before the first. */
  termStartedOn: string | null;
  interestPaid: InterestPaid;
  /** The day automation was last switched on. Monthly payouts before it were recorded by hand. */
  enabledOn: string;
}

export interface DepositEvent {
  kind: 'monthly' | 'maturity';
  dueOn: string;
  periodFrom: string;
  days: number;
}

export const eventKey = (kind: DepositEvent['kind'], dueOn: string): string => `${kind}:${dueOn}`;

/** The current term's first day: the stored one while it still adds up to the maturity, otherwise dated back from it. */
export function termStart(s: DepositSchedule): string {
  if (s.termStartedOn && addMonthsToDate(s.termStartedOn, s.termMonths) === s.maturesOn) return s.termStartedOn;
  return addMonthsToDate(s.maturesOn, -s.termMonths);
}

/**
 * Every event of the current term that is due and not yet confirmed, earliest first. Only the current term is ever
 * derived: the next one exists once its roll-over is confirmed, so an unconfirmed maturity holds back what follows.
 */
export function dueDepositEvents(s: DepositSchedule, done: ReadonlySet<string>, today: string): DepositEvent[] {
  const start = termStart(s);
  const events: DepositEvent[] = [];
  if (s.interestPaid === 'monthly') {
    for (let k = 1; k < s.termMonths; k++) {
      const periodFrom = addMonthsToDate(start, k - 1);
      const dueOn = addMonthsToDate(start, k);
      events.push({ kind: 'monthly', dueOn, periodFrom, days: daysFrom(periodFrom, dueOn) });
    }
  }
  const lastFrom = s.interestPaid === 'monthly' ? addMonthsToDate(start, s.termMonths - 1) : start;
  events.push({ kind: 'maturity', dueOn: s.maturesOn, periodFrom: lastFrom, days: daysFrom(lastFrom, s.maturesOn) });
  return events.filter(
    (event) => event.dueOn <= today && !done.has(eventKey(event.kind, event.dueOn)) && (event.kind === 'maturity' || event.dueOn >= s.enabledOn),
  );
}
