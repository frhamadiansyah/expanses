import { dayMonth, formatMinor, type InstallmentBilling, instalmentDueOn, monthName, owedAfter, periodMonthOf, type PlanPurchaseLine, unlinkedPurchaseOfTotal } from '@expanses/core';
import type { PlanInstalmentStatus } from '@expanses/db';

/*
 * The app decides how a plan counts (owner, 16 Nov 2026, TF 139) — no choice on any screen:
 * - tied to a spending purchase: its instalments are spending, a month at a time, in the purchase's category;
 * - tied to an investment buy, or with no purchase and Investment chosen: saving, never spending;
 * - with no purchase and a spending category (Uncategorised when none is chosen): spending in that category.
 * Kept as count_mode: Each month for spending, At purchase for an investment.
 */

const monthWords = (month: string, withYear: boolean) => `${monthName(month, 'long')}${withYear ? ` ${month.slice(0, 4)}` : ''}`;

/** The months a plan's instalments count in: "in each month from December to November 2027". Empty with none counted. */
function spanOf(schedule: readonly { statementOn: string }[], monthStart: number): string {
  const first = schedule[0] ? periodMonthOf(schedule[0].statementOn, monthStart) : null;
  const last = schedule.at(-1) ? periodMonthOf(schedule.at(-1)!.statementOn, monthStart) : null;
  if (!first || !last) return '';
  return first === last ? `in ${monthWords(first, true)}` : `in each month from ${monthWords(first, first.slice(0, 4) !== last.slice(0, 4) && schedule.length > 12)} to ${monthWords(last, true)}`;
}

/**
 * How a plan counts, said in one plain line (its page, and its sheet's footer):
 * "Counts Rp 1.000.000 a month as Electronics spending, in each month from December to November 2027." or
 * "Investment: Rp 1.000.000 a month counts as saving, not spending." With no purchase, only what is still owed counts:
 * the instalments after those paid (0124).
 */
export function countingLine(
  plan: { investment: boolean; monthlyMinor: number; transactionId: string | null },
  schedule: readonly { number: number; statementOn: string }[],
  currency: string,
  monthStart = 1,
  opts: { categoryName?: string | null; paidSoFar?: number } = {},
): string {
  const monthly = formatMinor(plan.monthlyMinor, currency);
  if (plan.investment) return `Investment: ${monthly} a month counts as saving, not spending.`;
  const counted = plan.transactionId ? schedule : schedule.filter((bill) => bill.number > (opts.paidSoFar ?? 0));
  if (counted.length === 0) return 'Every instalment is paid: nothing more counts as spending.';
  const span = spanOf(counted, monthStart);
  return `Counts ${monthly} a month as ${opts.categoryName ?? 'Uncategorised'} spending${span ? `, ${span}` : ''}.`;
}

/**
 * Whether a plan with no purchase may be counted twice (owner, 16 Nov 2026): only when the card holds a purchase of the
 * plan's total that no plan is tied to. Otherwise its purchase is simply not in the app, and nothing is said.
 */
export const mayCountTwice = (plan: { id: string | null; transactionId: string | null; totalMinor: number }, lines: readonly PlanPurchaseLine[]): boolean =>
  !plan.transactionId && unlinkedPurchaseOfTotal(lines, plan);

/** The line such a plan shows above Save and on its page: which purchase it probably is, said by what it would double. */
export function noPurchaseWarning(countTwice: boolean, investment: boolean, categoryName?: string | null): string | null {
  if (!countTwice) return null;
  return investment
    ? 'No purchase chosen: the card holds a purchase of this total, and each instalment is billed on top of it.'
    : `No purchase chosen: each instalment counts as ${categoryName ?? 'Uncategorised'} spending, on top of the purchase.`;
}

/** The plan's own page (mockup "after"): how far it is, what is left, when it ends, and its instalments. */
export interface PlanProgress {
  paid: number;
  billed: number;
  of: number;
  /** What is not yet paid: the total less the instalments paid. */
  leftMinor: number;
  /** The month the last instalment is billed in, as YYYY-MM. */
  endsMonth: string | null;
  /** Billed and paid instalments, newest first, after the next one still to come. */
  rows: PlanInstalmentStatus[];
}

export function planProgress(totalMinor: number, statuses: readonly PlanInstalmentStatus[]): PlanProgress {
  const paidRows = statuses.filter((row) => row.status === 'paid');
  const billedRows = statuses.filter((row) => row.status !== 'upcoming');
  const next = statuses.find((row) => row.status === 'upcoming');
  return {
    paid: paidRows.length,
    billed: billedRows.length,
    of: statuses.length,
    leftMinor: totalMinor - paidRows.reduce((sum, row) => sum + row.amountMinor, 0),
    endsMonth: statuses.at(-1)?.statementOn.slice(0, 7) ?? null,
    rows: [...(next ? [next] : []), ...[...billedRows].reverse()],
  };
}

/** "13 Nov 2026". */
export const dayMonthYear = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7), 'short')} ${iso.slice(0, 4)}`;

/** "13 March 2025": the day a plan is first billed, on the card's statement day (the sheet's First billed). */
export const firstBilledDate = (schedule: readonly InstallmentBilling[]): string | null => {
  const first = schedule[0]?.statementOn;
  return first ? `${Number(first.slice(8, 10))} ${monthName(first.slice(0, 7), 'long')} ${first.slice(0, 4)}` : null;
};

const monthYearLong = (iso: string) => `${monthName(iso.slice(0, 7), 'long')} ${iso.slice(0, 4)}`;

/** One row of a plan's Paid list (owner, 17 Nov 2026, mockup 1b): an instalment, or the older paid ones folded into one. */
export interface PaidRow {
  key: string;
  /** "21 of 24", or "1–18 of 24" for the folded row. */
  title: string;
  /** "13 Nov 2026 · due 2 Dec"; the folded row's months, or "Paid" on the plan's page. */
  subtitle: string;
  /** Null on the folded row. */
  amountMinor: number | null;
  ticked: boolean;
  /**
   * What a tap on its circle sets the plan's paid so far to (`tickedPaidSoFar`). Null when the circle is not the list's to
   * change: the folded row (a tap opens it), or an instalment a card payment covers.
   */
  tapTo: number | null;
  folded: boolean;
}

/**
 * A plan's instalments as its Paid list shows them, newest first: each one still owed, then the ticked ones — the
 * latest `open` of them on their own, the older folded into one row unless `expanded`. The next one to pay says when its
 * payment is due. On the plan's page (`today` given) only those billed and the next one to come are listed, and each says
 * where it stands. Ticking one ticks every one before it; unticking one unticks every one after it.
 */
export function paidListRows(opts: {
  schedule: readonly InstallmentBilling[];
  paidSoFar: number;
  dueDay: number | null;
  /** Instalments after `paidSoFar` the card's payments cover: paid, but not the list's to untick. */
  covered?: ReadonlySet<number>;
  /** The plan's page: list up to the next one still to come, and say how each stands. */
  today?: string;
  open: number;
  expanded: boolean;
}): PaidRow[] {
  const { schedule, paidSoFar, dueDay, today } = opts;
  const covered = opts.covered ?? new Set<number>();
  const of = schedule.length;
  const nextToPay = schedule.find((bill) => bill.number > paidSoFar && !covered.has(bill.number))?.number ?? null;
  const nextToCome = today ? (schedule.find((bill) => bill.statementOn > today)?.number ?? null) : null;
  const one = (bill: InstallmentBilling): PaidRow => {
    const ticked = bill.number <= paidSoFar;
    const paidByCard = !ticked && covered.has(bill.number);
    const words = [dayMonthYear(bill.statementOn)];
    if (bill.number === nextToPay) words.push(`due ${dayMonth(instalmentDueOn(bill.statementOn, dueDay))}`);
    else if (today && paidByCard) words.push('paid');
    else if (today && !ticked && bill.statementOn > today) words.push('upcoming');
    else if (today && !ticked) words.push('billed');
    return {
      key: String(bill.number),
      title: `${bill.number} of ${of}`,
      subtitle: words.join(' · '),
      amountMinor: bill.amountMinor,
      ticked: ticked || paidByCard,
      tapTo: paidByCard ? null : ticked ? bill.number - 1 : bill.number,
      folded: false,
    };
  };
  const owed = schedule.filter((bill) => bill.number > paidSoFar && (!today || nextToCome === null || bill.number <= nextToCome)).reverse();
  const paid = schedule.filter((bill) => bill.number <= paidSoFar).reverse();
  const shown = opts.expanded ? paid : paid.slice(0, opts.open);
  const rest = opts.expanded ? [] : paid.slice(opts.open);
  const rows = [...owed.map(one), ...shown.map(one)];
  if (rest.length === 1) rows.push(one(rest[0]!));
  else if (rest.length > 1) {
    const first = rest.at(-1)!;
    const last = rest[0]!;
    const from = monthYearLong(first.statementOn);
    const to = monthYearLong(last.statementOn);
    rows.push({ key: 'paid', title: `${first.number}–${last.number} of ${of}`, subtitle: today ? 'Paid' : from === to ? from : `${from} – ${to}`, amountMinor: null, ticked: true, tapTo: null, folded: true });
  }
  return rows;
}

/**
 * The line under the Paid list: what is still owed and where it is. "Owed: 21–24, Rp 4.000.000 — added to Visa's
 * balance." On a card with an opening balance of its own, the opening already holds it.
 */
export function owedFooter(plan: { totalMinor: number; months: number; monthlyMinor: number }, paidSoFar: number, currency: string, cardName: string, inOpening: boolean): string {
  const owed = owedAfter({ ...plan, firstBilledMonth: '', rateBps: 0, conversionFeeMinor: 0, earnsPoints: false }, paidSoFar);
  if (owed <= 0) return 'Owed: nothing. Every instalment is paid.';
  const which = paidSoFar + 1 === plan.months ? `${plan.months}` : `${paidSoFar + 1}–${plan.months}`;
  return `Owed: ${which}, ${formatMinor(owed, currency)} — ${inOpening ? `held in ${cardName}’s opening balance` : `added to ${cardName}’s balance`}.`;
}
