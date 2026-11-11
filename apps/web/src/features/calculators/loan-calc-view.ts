import {
  calculatorSchedule,
  effectiveYearlyCostBps,
  flatToEffectiveBps,
  formatMinor,
  groupedMajorString,
  halfRepaidMonth,
  type LoanCalcInput,
  type PaymentJump,
  paymentJump,
  type ScheduleRow,
  type StageLine,
  stageLines,
} from '@expanses/core';
import type { CalculatorPrefill } from '../ownables/debt-form';
import { rateTextPer } from '../loans/loan-view';
import { type LoanFacts, type LoanKind, ratePerOf } from './loan-calc-form';

/**
 * What the loan calculator's result page says, worked out apart from the page: the totals and their split, each rate
 * stage, and the lines that say what it means — the jump when a fixed rate ends, the price against everything paid,
 * the share of income, the month half the loan is repaid, what a flat rate really costs, and what an online loan
 * adds up to a year. Pure, so a test can hold each wording down.
 */

/** The page's own title for each kind, and the name a saved debt starts with. */
export const KIND_TITLE: Record<LoanKind, string> = { home: 'Home loan', vehicle: 'Vehicle loan', online: 'Online loan', other: 'Loan' };
/** The segment's label. */
export const KIND_LABEL: Record<LoanKind, string> = { home: 'Home', vehicle: 'Vehicle', online: 'Online', other: 'Other' };
/** The debt a kind is saved as. */
export const KIND_ITEM: Record<LoanKind, string> = { home: 'home_mortgage', vehicle: 'vehicle_leasing', online: 'online_loan', other: 'personal_loan' };

/** The kind a debt is worked out as, from Add debt's "Work it out first". */
export function kindOfItem(item: string): LoanKind {
  if (item === 'home_mortgage' || item === 'apartment_mortgage') return 'home';
  if (item === 'vehicle_leasing') return 'vehicle';
  if (item === 'online_loan') return 'online';
  return 'other';
}

/** A whole percent of a part in a whole, 0 when there is no whole. */
const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

/** "43,6": basis points as a percentage with one decimal, the decimal comma the rest of the app writes. */
const oneDecimal = (bps: number) => (bps / 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface LoanResult {
  rows: ScheduleRow[];
  totalPaidMinor: number;
  principalMinor: number;
  interestMinor: number;
  /** Whole percents that add up to 100. */
  principalPercent: number;
  interestPercent: number;
  lines: StageLine[];
  jump: PaymentJump | null;
  halfMonth: number | null;
}

export function loanResult(input: LoanCalcInput): LoanResult {
  const rows = calculatorSchedule(input);
  const totalPaidMinor = rows.reduce((total, row) => total + row.paymentMinor, 0);
  const interestMinor = rows.reduce((total, row) => total + row.interestMinor, 0);
  const principalPercent = percentOf(input.principalMinor, totalPaidMinor);
  const lines = stageLines(rows, input.stages);
  return {
    rows,
    totalPaidMinor,
    principalMinor: input.principalMinor,
    interestMinor,
    principalPercent,
    interestPercent: totalPaidMinor > 0 ? 100 - principalPercent : 0,
    lines,
    jump: paymentJump(lines),
    halfMonth: halfRepaidMonth(rows, input.principalMinor),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Total paid over 20 years" for a home, "Total paid over 48 months" for the rest. */
export function totalCaption(kind: LoanKind, months: number): string {
  if (kind === 'home' && months % 12 === 0) return `Total paid over ${plural(months / 12, 'year')}`;
  return `Total paid over ${plural(months, 'month')}`;
}

/** "Principal (loan) · 44%", and "Principal · 85%" for an online loan, whose principal is plainly the loan. */
export function principalLabel(kind: LoanKind, percent: number): string {
  return `${kind === 'online' ? 'Principal' : 'Principal (loan)'} · ${percent}%`;
}

/** "Interest is 126% of the loan." Nothing when there is none. */
export function interestOfLoan(result: Pick<LoanResult, 'interestMinor' | 'principalMinor'>): string | null {
  if (!(result.interestMinor > 0)) return null;
  return `Interest is ${percentOf(result.interestMinor, result.principalMinor)}% of the loan.`;
}

/** "Months 1–36", with "years 1–3" beside it for a home. */
export function stageTitle(line: StageLine, kind: LoanKind): { months: string; years: string | null } {
  const months = line.fromMonth === line.toMonth ? `Month ${line.fromMonth}` : `Months ${line.fromMonth}–${line.toMonth}`;
  if (kind !== 'home') return { months, years: null };
  const fromYear = Math.ceil(line.fromMonth / 12);
  const toYear = Math.ceil(line.toMonth / 12);
  return { months, years: fromYear === toYear ? `year ${fromYear}` : `years ${fromYear}–${toYear}` };
}

/** A yearly rate as written here: "5,5% a year". */
export const yearRate = (bps: number) => rateTextPer(bps, 'year').replace(/%$/, '% a year');

/** "5,5% a year · fixed", "4,5% a year · flat", "2,95% a month", "No interest". */
export function stageRate(line: StageLine, kind: LoanKind, method: LoanCalcInput['method']): string {
  if (method === 'zero' || line.rateBps === 0) return 'No interest';
  if (ratePerOf(kind) === 'month') return rateTextPer(line.rateBps, 'month');
  return `${yearRate(line.rateBps)} · ${method === 'flat' ? 'flat' : line.kind}`;
}

/**
 * The warning when a stage raises the payment: "Up Rp 2.161.551 a month (+43,6%) when the fixed rate ends. A floating
 * rate can move again later." A rise that does not end a fixed stage is dated by its month instead.
 */
export function jumpWarning(jump: PaymentJump | null, currency: string): string | null {
  if (!jump) return null;
  const when = jump.from.kind === 'fixed' ? 'when the fixed rate ends' : `from month ${jump.to.fromMonth}`;
  const floating = jump.to.kind === 'floating' ? ' A floating rate can move again later.' : '';
  return `Up ${formatMinor(jump.upMinor, currency)} a month (+${oneDecimal(jump.upBps)}%) ${when}.${floating}`;
}

/**
 * What a flat rate a year really costs on what is still owed — the loan page's own effective figure: "Flat 4,5% a year
 * works out to about 8,36% a year on what is still owed, because flat interest stays on the full loan the whole time."
 */
export function flatNote(input: LoanCalcInput, kind: LoanKind): { lead: string; figure: string; tail: string } | null {
  const months = input.stages.reduce((total, stage) => total + stage.months, 0);
  const rateBps = input.stages[0]?.rateBps ?? 0;
  if (input.method !== 'flat' || ratePerOf(kind) !== 'year' || months <= 1 || rateBps === 0) return null;
  return {
    lead: `Flat ${yearRate(rateBps)} works out to about `,
    figure: yearRate(flatToEffectiveBps(rateBps, months)),
    tail: ' on what is still owed, because flat interest stays on the full loan the whole time.',
  };
}

/** "Fee at the start Rp 180.000 · cost of borrowing Rp 1.242.000 (20,7%)" — the fee and the interest together, against the loan. */
export function feeLine(facts: LoanFacts, interestMinor: number, currency: string): string | null {
  const costMinor = facts.feeMinor + interestMinor;
  if (!(facts.feeMinor > 0)) return null;
  const share = oneDecimal(facts.loanMinor > 0 ? Math.round((costMinor * 10_000) / facts.loanMinor) : 0);
  return `Fee at the start ${formatMinor(facts.feeMinor, currency)} · cost of borrowing ${formatMinor(costMinor, currency)} (${share}%)`;
}

/**
 * What an online loan (or any loan with a fee) adds up to a year: the compounded rate at which its payments are worth
 * what arrived after the fee. "Adds up to about 97% a year. Only Rp 5.820.000 arrives after the fee, and the payments
 * are on the full Rp 6.000.000."
 */
export function yearlyCostWarning(facts: LoanFacts, rows: readonly ScheduleRow[], currency: string): { lead: string; figure: string; tail: string } | null {
  const received = facts.loanMinor - facts.feeMinor;
  const bps = effectiveYearlyCostBps(received, rows.map((row) => row.paymentMinor));
  if (bps === null || bps === 0) return null;
  // Grouped as every figure here is; past 1.000% a year the exact figure means nothing and is not written out.
  const percent = bps >= 1_000 ? Math.round(bps / 100).toLocaleString('id-ID') : (bps / 100).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  const tail =
    facts.feeMinor > 0
      ? ` Only ${formatMinor(received, currency)} arrives after the fee, and the payments are on the full ${formatMinor(facts.loanMinor, currency)}.`
      : '';
  const figure = bps > 100_000 ? 'over 1.000% a year' : `${percent}% a year`;
  return { lead: 'Adds up to about ', figure, tail: `.${tail}` };
}

/** One part of the price against everything paid: the bar's segment and its line. */
export interface PaidPart {
  key: 'down' | 'costs' | 'loan' | 'interest';
  label: string;
  minor: number;
}

/**
 * The price against everything paid, for a home or a vehicle with a price: the down payment, the costs at the start,
 * the loan and its interest, and the total they come to against the price.
 */
export function priceVsPaid(kind: LoanKind, facts: LoanFacts, interestMinor: number, currency: string): { caption: string; parts: PaidPart[]; total: string } | null {
  if (!(facts.priceMinor > 0)) return null;
  const parts: PaidPart[] = [
    { key: 'down' as const, label: 'Down payment', minor: facts.downMinor },
    { key: 'costs' as const, label: kind === 'vehicle' ? 'Admin and insurance' : 'Upfront costs', minor: facts.costsMinor },
    { key: 'loan' as const, label: 'Loan', minor: facts.loanMinor },
    { key: 'interest' as const, label: 'Interest', minor: interestMinor },
  ].filter((part) => part.minor > 0);
  const totalMinor = parts.reduce((total, part) => total + part.minor, 0);
  const thing = kind === 'home' ? 'house' : 'vehicle';
  return {
    caption: kind === 'home' ? 'House price vs everything paid' : 'Vehicle price vs everything paid',
    parts,
    total: `Total ${formatMinor(totalMinor, currency)} for a ${formatMinor(facts.priceMinor, currency)} ${thing}`,
  };
}

export type IncomeBand = 'comfortable' | 'stretched' | 'heavy';

/**
 * The payment as a share of the monthly income: the first stage's, and the highest one's when a stage raises it.
 * Under 30% stays comfortable, 30% to 40% is stretched, over 40% is heavy — judged on the highest, rounded as shown.
 */
export function incomeShare(lines: readonly StageLine[], incomeMinor: number): { tag: string; widthPercent: number; band: IncomeBand; note: string } | null {
  if (!(incomeMinor > 0) || lines.length === 0) return null;
  const first = lines[0]!.paymentMinor;
  const highest = Math.max(...lines.map((line) => line.paymentMinor));
  const firstPercent = percentOf(first, incomeMinor);
  const highestPercent = percentOf(highest, incomeMinor);
  // Judged on the percent the tag shows, so a tag of 30% is never called under 30%.
  const band: IncomeBand = highestPercent < 30 ? 'comfortable' : highestPercent <= 40 ? 'stretched' : 'heavy';
  const note = band === 'comfortable' ? 'Under 30% stays comfortable.' : band === 'stretched' ? 'Between 30% and 40% is stretched.' : 'Over 40% leaves little room.';
  return {
    tag: highest > first ? `${firstPercent}% → ${highestPercent}%` : `${firstPercent}%`,
    widthPercent: Math.min(100, highestPercent),
    band,
    note,
  };
}

/** "month 172" and "(year 15)". */
export function halfRepaidText(month: number | null): { month: string; year: string } | null {
  if (month === null) return null;
  return { month: `month ${month}`, year: `(year ${Math.ceil(month / 12)})` };
}

/** Save as debt: the debt, its name and owed figure as Add debt's boxes show them, the months, and the loan's shape. */
export function debtPrefill(kind: LoanKind, input: LoanCalcInput, currency: string, item?: string): CalculatorPrefill {
  return {
    // The debt Add debt sent here, while the kind still matches it; switching kinds files it as the new kind's debt.
    item: item && kindOfItem(item) === kind ? item : KIND_ITEM[kind],
    name: KIND_TITLE[kind],
    owed: groupedMajorString(input.principalMinor, currency),
    months: input.stages.reduce((total, stage) => total + stage.months, 0),
    firstPaymentOn: input.firstPaymentOn,
    method: input.method,
    stages: input.stages.map((stage) => ({ ...stage })),
  };
}

/** A figure in a table cell, grouped and without the currency: "4.952.789". */
export const cell = (minor: number, currency: string) => groupedMajorString(minor, currency);
