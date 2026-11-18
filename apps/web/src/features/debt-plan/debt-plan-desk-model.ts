import { addMonths, daysFrom, type ExtraEffect, formatMinor, monthOf, type PayoffPlan } from '@expanses/core';
import type { LoanPlanFact } from '@expanses/db';
import { monthYearLabel, repaidPercent } from '../loans/loan-view';
import { dayMonth } from '../networth/debt-rows';
import { debtKind } from '../networth/sheet-drawers';
import type { PlanDebt, PlanItem } from './plan-inputs';
import { type PayFirstRow, payFirstRows, ratePerWords } from './plan-view';
import { instalmentNumberFrom, monthItems } from './schedule-view';

/**
 * The Mac Debt-free plan's readings (owner 2026-11-18): the payoff line with and without the extra, each debt's late
 * payments and next one for the table and the peek, and the Schedule's late section with a debt's instalments in one
 * row. Pure, read off what the phone's plan already reads — the same items, the same figures — so a test holds every
 * rule down.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const monthsBetween = (from: string, to: string): number => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

// ── The payoff line ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PayoffLine {
  /** What is left now (index 0), then at the end of each month from the start month on: index i + 1 is month i's end. */
  points: number[];
  /** The debt-free month, YYYY-MM. */
  endMonth: string;
}

export interface PayoffLines {
  /** The plan as saved: with the extra when there is one. */
  plan: PayoffLine;
  /** The same order with no extra; null when no extra is set, or it changes nothing. */
  without: PayoffLine | null;
  startMonth: string;
  /** How many months the drawing spans: the longer line's. */
  span: number;
}

const lineOf = (plan: PayoffPlan, nowMinor: number): PayoffLine | null => (plan.unknown || plan.debtFreeMonth === null ? null : { points: [nowMinor, ...plan.leftByMonth], endMonth: plan.debtFreeMonth });

/**
 * Left to pay over time from the plan's two runs (`extraEffect`): the line with the extra, and the one without it when an
 * extra is set. Null when the month is not known (a debt with no terms, or one never cleared) — the box says why instead.
 * `nowMinor` is what the engine starts from: every owing debt's balance in the base currency.
 */
export function payoffLines(effect: ExtraEffect, extraMinor: number, startMonth: string, nowMinor: number): PayoffLines | null {
  const plan = lineOf(effect.plan, nowMinor);
  if (!plan || nowMinor <= 0) return null;
  const baseline = extraMinor > 0 ? lineOf(effect.baseline, nowMinor) : null;
  const without = baseline && baseline.points.length !== plan.points.length ? baseline : baseline && baseline.points.some((p, i) => p !== plan.points[i]) ? baseline : null;
  return { plan, without, startMonth, span: Math.max(plan.points.length, without?.points.length ?? 0) - 1 };
}

/** What the engine starts from: every owing debt's balance as it was handed in (base currency). */
export function payoffStartMinor(debts: readonly PlanDebt[]): number {
  return debts.reduce((sum, d) => sum + (!d.paidOff && d.payoff ? d.payoff.balanceMinor : 0), 0);
}

/** "Dec 2030". */
export const shortMonth = (month: string): string => monthYearLabel(month);

/**
 * The years along the line's foot: each January inside the span (at its distance from the start, in months), and the
 * start's own year when its first January is far enough off to leave room. A long span names every second or fifth year.
 */
export function yearTicks(startMonth: string, span: number): { at: number; label: string }[] {
  const ticks: { at: number; label: string }[] = [];
  const firstJan = `${Number(startMonth.slice(0, 4)) + (startMonth.slice(5, 7) === '01' ? 0 : 1)}-01`;
  const years = Math.floor(span / 12) + 1;
  const every = years > 24 ? 5 : years > 10 ? 2 : 1;
  if (startMonth.slice(5, 7) !== '01' && monthsBetween(startMonth, firstJan) >= 4) ticks.push({ at: 0, label: startMonth.slice(0, 4) });
  for (let month = firstJan, n = 0; monthsBetween(startMonth, month) <= span; month = addMonths(month, 12), n += 1) {
    if (n % every === 0) ticks.push({ at: monthsBetween(startMonth, month), label: month.slice(0, 4) });
  }
  return ticks;
}

// ── Each debt's kind, late payments and next one ────────────────────────────────────────────────────────────────────

/** The colours each kind of debt is drawn in, as the Liabilities page's picker groups them. */
const KIND_COLOURS: Record<string, string> = {
  home_mortgage: '#5856d6',
  apartment_mortgage: '#5856d6',
  vehicle_leasing: '#30b0c7',
  multi_purpose_loan: '#34c759',
  other_loans: '#34c759',
  online_loan: '#ff9500',
  credit_card: '#0a7cff',
};

/** The kind a debt wears (the Liabilities page's own reading, `debtKind`), and its colour. */
export function debtKindLook(debt: Pick<PlanDebt, 'itemId' | 'icon'>): { key: string; label: string; colour: string } {
  const kind = debtKind(debt.itemId, debt.icon);
  return { ...kind, colour: KIND_COLOURS[kind.key] ?? '#8e8e93' };
}

export interface DeskContext {
  today: string;
  loanFacts: readonly LoanPlanFact[];
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}

/**
 * A debt's payments late now, oldest first, as the Schedule lists them this month: a loan's every late instalment (the
 * Schedule's own items), a card's statement or a person's due date when it is past.
 */
export function lateOf(debt: PlanDebt, ctx: DeskContext): PlanItem[] {
  if (debt.paidOff) return [];
  if (debt.kind === 'loan') {
    const items = monthItems({
      month: monthOf(ctx.today),
      today: ctx.today,
      debts: [debt],
      loanFacts: ctx.loanFacts,
      cards: [],
      bills: [],
      show: { loans: true, cards: false, bills: false },
      baseCurrency: ctx.baseCurrency,
      ratesToBase: ctx.ratesToBase,
    });
    return items.filter((i) => i.status === 'late' && i.kind === 'loan').sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }
  return debt.next && debt.next.status === 'late' ? [debt.next] : [];
}

/** One payment ahead: when, how much, and for a loan its number. */
export interface NextPayment {
  dueOn: string;
  minor: number | null;
  currency: string;
  /** "4/24" for a loan's instalment. */
  number: string | null;
}

/** The payments still to come (none late), soonest first, up to `count`: a loan's schedule, else the debt's next one. */
export function upcomingOf(debt: PlanDebt, ctx: DeskContext, count: number): NextPayment[] {
  if (debt.paidOff) return [];
  if (debt.kind === 'loan') {
    const fact = ctx.loanFacts.find((f) => f.accountId === debt.accountId);
    if (!fact || debt.instalmentOf === null) return [];
    // A schedule row already past is this month's instalment still unpaid: late, and listed with the late ones.
    return fact.schedule.filter((row) => row.onDate >= ctx.today).slice(0, count).map((row) => {
      const number = fact.instalments.find((i) => i.dueOn === row.onDate)?.number ?? instalmentNumberFrom(debt, fact, row.onDate);
      return { dueOn: row.onDate, minor: row.paymentMinor, currency: debt.currency, number: `${number}/${debt.instalmentOf}` };
    });
  }
  return debt.next && debt.next.status === 'upcoming' ? [{ dueOn: debt.next.dueOn, minor: debt.next.minor, currency: debt.currency, number: null }].slice(0, count) : [];
}

/** The table's Next cell: "20 Nov · Rp 2.770.630", "20 Nov", or "no fixed months" for a debt with no due date. */
export function nextCell(debt: PlanDebt, ctx: DeskContext): string {
  const [next] = upcomingOf(debt, ctx, 1);
  if (next) return next.minor !== null ? `${dayMonth(next.dueOn)} · ${formatMinor(next.minor, next.currency)}` : dayMonth(next.dueOn);
  if (debt.kind === 'person' || debt.kind === 'payable') return debt.next ? '—' : 'no fixed months';
  return '—';
}

/** The table's Late cell: "23 payments late" and what they come to in the debt's money; null when nothing is late. */
export function lateCell(items: readonly PlanItem[]): { words: string; minor: number; currency: string } | null {
  if (items.length === 0) return null;
  return { words: `${plural(items.length, 'payment')} late`, minor: items.reduce((sum, i) => sum + (i.minor ?? 0), 0), currency: items[0]!.currency };
}

/** "12%": the share repaid, the phone's own rule (`repaidPercent`). */
export const progressOf = (debt: Pick<PlanDebt, 'borrowedMinor' | 'leftMinor'>): number => repaidPercent(debt.borrowedMinor, debt.leftMinor);

/** "Oct · 3/24" for a late instalment, "Statement · 3 Nov" for anything else — what the peek's late row says. */
function lateWhen(item: PlanItem): string {
  const number = item.kind === 'loan' ? item.title.split(' · ').at(-1) : null;
  return number ? `${monthYearLabel(item.dueOn.slice(0, 7)).split(' ')[0]} · ${number}` : item.detail;
}

export interface PeekPayment {
  key: string;
  /** "29 days late", red; null for one still to come. */
  late: string | null;
  when: string;
  minor: number | null;
  currency: string;
}

/** The peek's NEXT PAYMENTS: what is late first (oldest first), then what comes next — `count` rows in all. */
export function nextPayments(debt: PlanDebt, ctx: DeskContext, count = 3): PeekPayment[] {
  const late = lateOf(debt, ctx).map((item) => ({ key: item.key, late: `${plural(Math.max(1, item.daysLate), 'day')} late`, when: lateWhen(item), minor: item.minor, currency: item.currency }));
  const ahead = upcomingOf(debt, ctx, count).map((next) => ({ key: `${next.dueOn}`, late: null, when: next.number ? `${dayMonth(next.dueOn)} · ${next.number}` : dayMonth(next.dueOn), minor: next.minor, currency: next.currency }));
  return [...late, ...ahead].slice(0, count);
}

/** The peek's Instalment row: "Rp 2.770.630 · 3 of 24" — the next instalment to pay, by its number. */
export function instalmentWords(debt: PlanDebt, ctx: DeskContext): string | null {
  if (debt.kind !== 'loan' || debt.instalmentOf === null) return null;
  const late = lateOf(debt, ctx)[0];
  const [next] = upcomingOf(debt, ctx, 1);
  const minor = late?.minor ?? next?.minor ?? null;
  const number = debt.instalmentsPaid !== null ? Math.min(debt.instalmentOf, debt.instalmentsPaid + 1) : null;
  const figure = minor !== null ? formatMinor(minor, debt.currency) : null;
  return [figure, number !== null ? `${number} of ${debt.instalmentOf}` : null].filter(Boolean).join(' · ') || null;
}

/** The peek's Ends row: "Jul 2028", with " · with extra Feb 2027" when the extra brings it forward. */
export function endsWords(debt: PlanDebt, effect: ExtraEffect, extraMinor: number): string | null {
  if (!debt.endsMonth) return null;
  const withExtra = extraMinor > 0 ? effect.plan.debts.find((d) => d.key === debt.key)?.endMonth ?? null : null;
  return withExtra && withExtra < debt.endsMonth ? `${monthYearLabel(debt.endsMonth)} · with extra ${monthYearLabel(withExtra)}` : monthYearLabel(debt.endsMonth);
}

// ── The Debts table ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface DeskDebtRow {
  /** The phone's Pay first row: its place ("!" when late), Pay. */
  row: PayFirstRow;
  look: { key: string; label: string; colour: string };
  /** The Rate cell, today's words: "10,8% a year", "2% a month", "No terms yet", "0%". */
  rate: string;
  progress: number;
  next: string;
  late: { words: string; minor: number; currency: string } | null;
}

/** The rate as the wide table has always said it: a loan's own, every other debt 0%. */
export function rateWords(debt: PlanDebt): string {
  if (debt.kind !== 'loan') return '0%';
  return debt.hasTerms && debt.rateBps !== null ? ratePerWords(debt.rateBps, debt.ratePer) : 'No terms yet';
}

/** Every active debt in the phone's pay-first order (late first with "!", then numbered by the chosen order), with its cells. */
export function deskDebtRows(debts: readonly PlanDebt[], order: readonly string[], extraMinor: number, ctx: DeskContext): DeskDebtRow[] {
  return payFirstRows(debts, order, extraMinor, ctx.baseCurrency).map((row) => ({
    row,
    look: debtKindLook(row.debt),
    rate: rateWords(row.debt),
    progress: progressOf(row.debt),
    next: nextCell(row.debt, ctx),
    late: lateCell(lateOf(row.debt, ctx)),
  }));
}

// ── The Schedule's late section ─────────────────────────────────────────────────────────────────────────────────────

export type LateRow =
  | {
      type: 'group';
      key: string;
      debtKey: string;
      name: string;
      /** Its instalments, oldest first: what Pay all pays, in this order. */
      items: PlanItem[];
      /** "Jan 2025 – Nov 2026". */
      range: string;
      /** In the debt's own money. */
      minor: number;
      currency: string;
    }
  | { type: 'single'; key: string; item: PlanItem };

/** "Jan 2025 – Nov 2026", or one month alone. */
export function rangeWords(from: string, to: string): string {
  const a = monthYearLabel(from.slice(0, 7));
  const b = monthYearLabel(to.slice(0, 7));
  return a === b ? a : `${a} – ${b}`;
}

/**
 * The late section's rows: a loan with two or more instalments late is ONE row ("23 instalments late", its range and
 * total), every other late item its own row as today. Rows go by their oldest payment, as the phone's Late does.
 */
export function lateRows(late: readonly PlanItem[]): LateRow[] {
  const byDebt = new Map<string, PlanItem[]>();
  for (const item of late) if (item.kind === 'loan' && item.debtKey) byDebt.set(item.debtKey, [...(byDebt.get(item.debtKey) ?? []), item]);
  const rows: (LateRow & { oldest: string; title: string })[] = [];
  const grouped = new Set<string>();
  for (const [debtKey, items] of byDebt) {
    if (items.length < 2) continue;
    const sorted = [...items].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    grouped.add(debtKey);
    rows.push({
      type: 'group',
      key: `group:${debtKey}`,
      debtKey,
      name: sorted[0]!.name,
      items: sorted,
      range: rangeWords(sorted[0]!.dueOn, sorted.at(-1)!.dueOn),
      minor: sorted.reduce((sum, i) => sum + (i.minor ?? 0), 0),
      currency: sorted[0]!.currency,
      oldest: sorted[0]!.dueOn,
      title: sorted[0]!.name,
    });
  }
  for (const item of late) {
    if (item.kind === 'loan' && item.debtKey && grouped.has(item.debtKey)) continue;
    rows.push({ type: 'single', key: item.key, item, oldest: item.dueOn, title: item.title });
  }
  return rows.sort((a, b) => a.oldest.localeCompare(b.oldest) || a.title.localeCompare(b.title)).map(({ oldest: _o, title: _t, ...row }) => row as LateRow);
}

/** "23 instalments late" for a group. */
export const groupWords = (row: Extract<LateRow, { type: 'group' }>): string => `${plural(row.items.length, 'instalment')} late`;

/**
 * The late section's header: how many debts (and bills) are late and what it all comes to — the Late box's own figure,
 * the same rule (`monthTotals`): every late item counted in the totals, at its base figure. Null total when a rate is missing.
 */
export function lateHead(late: readonly PlanItem[]): { words: string; totalMinor: number | null } {
  const debts = new Set(late.flatMap((i) => (i.debtKey && i.kind !== 'bill' ? [i.debtKey] : [])));
  const bills = new Set(late.filter((i) => i.kind === 'bill').map((i) => i.key));
  const words = [debts.size > 0 ? plural(debts.size, 'debt') : null, bills.size > 0 ? plural(bills.size, 'bill') : null].filter(Boolean).join(' · ');
  const counted = late.filter((i) => i.inTotals !== false);
  const missing = counted.some((i) => i.minor !== null && i.baseMinor === null);
  return { words, totalMinor: missing ? null : counted.reduce((sum, i) => sum + (i.baseMinor ?? 0), 0) };
}

/**
 * Coming up in the next `days` days from today: this month's upcoming items and next month's up to the day, soonest
 * first, each once.
 */
export function comingUp(thisMonth: readonly PlanItem[], nextMonth: readonly PlanItem[], today: string, days = 30): PlanItem[] {
  const seen = new Set<string>();
  return [...thisMonth, ...nextMonth]
    .filter((i) => i.status === 'upcoming' && daysFrom(today, i.dueOn) <= days)
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title));
}

/** A row the Schedule can pay with others in one go: an unpaid loan instalment in the base currency (the Pay sheet's own figure). */
export const tickable = (item: PlanItem, baseCurrency: string): boolean => item.kind === 'loan' && item.status !== 'paid' && item.currency === baseCurrency && item.pay !== null;

/** What ticked rows come to (their own figures; every ticked row is in the base currency). */
export const tickedTotal = (items: readonly PlanItem[]): number => items.reduce((sum, i) => sum + (i.minor ?? 0), 0);

/** Ticked instalments in the order they are paid: per loan, oldest first — a payment always settles a loan's oldest one. */
export function payOrder(items: readonly PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => (a.debtKey ?? '').localeCompare(b.debtKey ?? '') || a.dueOn.localeCompare(b.dueOn));
}

/**
 * A tick on a loan's instalment: a payment always settles the loan's oldest one still unpaid, so ticking one ticks every
 * earlier one of the same loan with it, and unticking one unticks the later ones — the ticks always say what Pay pays.
 */
export function toggleTick(picked: ReadonlySet<string>, item: PlanItem, rows: readonly PlanItem[]): Set<string> {
  const same = rows.filter((row) => row.kind === 'loan' && row.debtKey === item.debtKey && row.status !== 'paid').sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const at = same.findIndex((row) => row.key === item.key);
  const next = new Set(picked);
  if (picked.has(item.key)) for (const row of same.slice(Math.max(0, at))) next.delete(row.key);
  else for (const row of same.slice(0, at + 1)) next.add(row.key);
  if (at < 0) {
    if (picked.has(item.key)) next.delete(item.key);
    else next.add(item.key);
  }
  return next;
}
