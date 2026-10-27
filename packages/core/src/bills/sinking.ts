import { roundUpToMajor } from '../money/money';
import { addMonths, monthOf } from '../reports/periods';
import { nextOccurrenceMonth } from './schedule';

/*
 * A sinking fund: money put aside each month for a yearly bill. The earmark is COMPUTED from the day, so it needs no
 * job to run and cannot drift. The model (0103):
 *
 *   - `monthlyMinor` + `startedMonth` are the fund's first plan, in force from the start month.
 *   - Everything that happens afterwards is an ENTRY:
 *       'opening'  money already saved when the fund was set up (added once, on top of the months)
 *       'extra'    one-off money put in, dated (added once)
 *       'skip'     a begun month that adds nothing (`month` = YYYY-MM)
 *       'plan'     the monthly figure in force FROM `month` (YYYY-MM), until a later plan entry replaces it
 *   - Saved = opening + extras + the monthly figure in force for each begun month (start month .. current month, the
 *     current one counts) that is not skipped, capped at the bill amount. Walking month by month is what lets a
 *     recalculated figure change only the months to come while the months already counted keep what they added.
 *
 * Recalculating: `remaining / months left`, rounded UP to a whole major unit of the currency (so the bill is always
 * reached). After a change made today the current month is already settled (added, or skipped), so the new figure
 * applies from NEXT month and the months left run from next month up to, but not including, the due month, never
 * below one. (The owner's numbers: Rp 612.385 set up in October for April, skip November => remaining 510.320 over
 * the 4 months December..March = 127.580.) Saving the form again recalculates from the current month instead
 * ('now': the current month is still to be settled, so it counts among the months left).
 */

/** Whole months from one YYYY-MM to another; negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/** What to set aside each month to reach `remainingMinor` in `monthsLeft` months, rounded up to a whole major unit. */
export function recalcMonthly(remainingMinor: number, monthsLeft: number, currency: string): number {
  if (remainingMinor <= 0) return 0;
  return roundUpToMajor(Math.ceil(remainingMinor / Math.max(1, monthsLeft)), currency);
}

export interface SinkingPlan {
  /** YYYY-MM the bill is next due in. */
  dueMonth: string;
  /** Months to save in, this one included, never below one. */
  monthsLeft: number;
  /** The amount to set aside each month: enough to reach the bill, rounded up to a whole unit of the currency. */
  monthlyMinor: number;
}

/**
 * What to set aside each month for a yearly bill made today. A date already past this month means next year's, and a
 * bill due this month or next leaves one month, so the whole amount is set aside at once.
 */
export function sinkingPlan(input: { targetMinor: number; today: string; repeatMonth: number; dayOfMonth: number; currency: string; repeatEvery?: number | null; startsMonth?: string }): SinkingPlan {
  const dueMonth = nextOccurrenceMonth(input.today, input.repeatMonth, input.dayOfMonth, input.repeatEvery, input.startsMonth);
  const monthsLeft = Math.max(1, monthsBetween(monthOf(input.today), dueMonth));
  const monthlyMinor = recalcMonthly(input.targetMinor, monthsLeft, input.currency);
  return { dueMonth, monthsLeft, monthlyMinor };
}

export type SinkingEntryKind = 'opening' | 'extra' | 'skip' | 'plan';

export interface SinkingEntry {
  id: string;
  kind: SinkingEntryKind;
  /** YYYY-MM for a skip (the month skipped) or a plan (the month it takes effect); null otherwise. */
  month: string | null;
  /** Money for opening and extra, the monthly figure for a plan, 0 for a skip. */
  amountMinor: number;
  /** YYYY-MM-DD the entry was made. */
  occurredOn: string;
}

export interface SinkingFundFacts {
  /** The first plan's monthly figure, in force from `startedMonth`. */
  monthlyMinor: number;
  /** YYYY-MM the saving began; that month counts. */
  startedMonth: string;
  entries: readonly SinkingEntry[];
}

export interface SinkingMonth {
  month: string;
  /** 1-based place in the run of months since the start. */
  index: number;
  /** What the month added: its monthly figure, 0 when skipped. */
  amountMinor: number;
  skipped: boolean;
  current: boolean;
}

export interface SinkingProgress {
  /** What is set aside today, never above the target. */
  savedMinor: number;
  /** The same before the cap. */
  rawMinor: number;
  /** Opening, extras and every begun month before the current one (skips left out): what is settled for good. */
  closedMinor: number;
  /** Months begun, this one included, never above `monthsTotal`. */
  monthsDone: number;
  /** Months from the start to the due month, at least one. */
  monthsTotal: number;
  /** The figure set aside each month from next month on: what 'Each month' shows. */
  monthlyMinor: number;
  /** Every begun month, oldest first. */
  months: SinkingMonth[];
}

/** The monthly figure in force for `month`: the latest plan entry taking effect on or before it, else the first plan. */
export function monthlyAt(fund: SinkingFundFacts, month: string): number {
  let best: SinkingEntry | null = null;
  for (const entry of fund.entries) {
    if (entry.kind !== 'plan' || entry.month === null || entry.month > month) continue;
    if (!best || entry.month >= best.month!) best = entry;
  }
  return best ? best.amountMinor : fund.monthlyMinor;
}

const MAX_WALK = 600;

export function sinkingProgress(fund: SinkingFundFacts, targetMinor: number, dueMonth: string, today: string): SinkingProgress {
  const current = monthOf(today);
  const skipped = new Set(fund.entries.filter((e) => e.kind === 'skip' && e.month).map((e) => e.month!));
  const lump = fund.entries.filter((e) => e.kind === 'opening' || e.kind === 'extra').reduce((sum, e) => sum + e.amountMinor, 0);
  const begun = Math.max(0, Math.min(MAX_WALK, monthsBetween(fund.startedMonth, current) + 1));
  const months: SinkingMonth[] = [];
  let closed = lump;
  let raw = lump;
  for (let i = 0; i < begun; i++) {
    const month = addMonths(fund.startedMonth, i);
    const isSkipped = skipped.has(month);
    const amountMinor = isSkipped ? 0 : monthlyAt(fund, month);
    const isCurrent = month === current;
    months.push({ month, index: i + 1, amountMinor, skipped: isSkipped, current: isCurrent });
    raw += amountMinor;
    if (!isCurrent) closed += amountMinor;
  }
  const monthsTotal = Math.max(1, monthsBetween(fund.startedMonth, dueMonth));
  const next = addMonths(current > fund.startedMonth ? current : fund.startedMonth, 1);
  return {
    savedMinor: Math.max(0, Math.min(targetMinor, raw)),
    rawMinor: raw,
    closedMinor: closed,
    monthsDone: Math.min(monthsTotal, begun),
    monthsTotal,
    monthlyMinor: monthlyAt(fund, next),
    months,
  };
}

/**
 * The monthly figure that reaches the bill from here. 'next': a change made today (skip, extra) — the current month is
 * settled, so it is worked out from what is saved over the months from next month up to the due month. 'now': the
 * form saved again — the current month is still to be settled and counts among the months left.
 */
export function sinkingRecalc(
  fund: SinkingFundFacts,
  targetMinor: number,
  dueMonth: string,
  today: string,
  currency: string,
  from: 'now' | 'next' = 'next',
): { monthlyMinor: number; monthsLeft: number; effectiveFrom: string } {
  const progress = sinkingProgress(fund, targetMinor, dueMonth, today);
  const current = monthOf(today);
  const base = current > fund.startedMonth ? current : fund.startedMonth;
  if (from === 'now') {
    const monthsLeft = Math.max(1, monthsBetween(base, dueMonth));
    return { monthlyMinor: recalcMonthly(targetMinor - progress.closedMinor, monthsLeft, currency), monthsLeft, effectiveFrom: base };
  }
  const monthsLeft = Math.max(1, monthsBetween(base, dueMonth) - 1);
  return { monthlyMinor: recalcMonthly(targetMinor - progress.rawMinor, monthsLeft, currency), monthsLeft, effectiveFrom: addMonths(base, 1) };
}

/** The fund with a plan entry added: later plans (from the same month or after) are replaced by it. */
export function withPlan(fund: SinkingFundFacts, from: string, monthlyMinor: number): SinkingFundFacts {
  const kept = fund.entries.filter((e) => !(e.kind === 'plan' && e.month !== null && e.month >= from));
  return { ...fund, entries: [...kept, { id: `plan-${from}`, kind: 'plan', month: from, amountMinor: monthlyMinor, occurredOn: `${from}-01` }] };
}

export interface SinkingExtraPreview {
  savedMinor: number;
  monthlyMinor: number;
  wasMonthlyMinor: number;
  monthsLeft: number;
  /** Money the extra adds to what is promised (an extra past the bill adds only up to it). */
  promisedMinor: number;
}

/** What putting in `amountMinor` today leaves: the new Saved figure and the monthly figure (kept as it was or recalculated). */
export function sinkingExtraPreview(
  fund: SinkingFundFacts,
  targetMinor: number,
  dueMonth: string,
  today: string,
  currency: string,
  amountMinor: number,
  keepMonthly: boolean,
): SinkingExtraPreview {
  const before = sinkingProgress(fund, targetMinor, dueMonth, today);
  const after: SinkingFundFacts = { ...fund, entries: [...fund.entries, { id: 'new-extra', kind: 'extra', month: null, amountMinor, occurredOn: today }] };
  const recalculated = sinkingRecalc(after, targetMinor, dueMonth, today, currency, 'next');
  const saved = sinkingProgress(after, targetMinor, dueMonth, today).savedMinor;
  return {
    savedMinor: saved,
    monthlyMinor: keepMonthly ? before.monthlyMinor : recalculated.monthlyMinor,
    wasMonthlyMinor: before.monthlyMinor,
    monthsLeft: recalculated.monthsLeft,
    promisedMinor: saved - before.savedMinor,
  };
}

export interface SinkingSaveInput {
  existing: SinkingFundFacts | null;
  /** Whether the existing monthly figure was typed by the owner (kept through a skip). */
  existingCustom: boolean;
  targetMinor: number;
  /** The bill's amount when it was last saved; a different amount recalculates an automatic figure. */
  oldTargetMinor?: number | null;
  today: string;
  dueMonth: string;
  currency: string;
  /** What the owner typed for 'Each month'; null works it out. */
  typedMonthlyMinor: number | null;
  /** 'Already saved': undefined leaves it as it was, 0 or null clears it. */
  openingMinor?: number | null;
}

export interface SinkingSaveResult {
  /** The fund after the save. */
  facts: SinkingFundFacts;
  custom: boolean;
  /** The plan entry to write, if the monthly figure changed. */
  plan: { from: string; monthlyMinor: number } | null;
  /** The opening amount to store; undefined leaves it. */
  openingMinor: number | null | undefined;
}

/** What saving the bill form does to a fund: a new fund, or an edit of one. Pure, so the refusal can be checked first. */
export function sinkingSavePlan(input: SinkingSaveInput): SinkingSaveResult {
  const month = monthOf(input.today);
  const opening = input.openingMinor === undefined ? undefined : input.openingMinor && input.openingMinor > 0 ? input.openingMinor : null;
  const withOpening = (fund: SinkingFundFacts): SinkingFundFacts => {
    if (opening === undefined) return fund;
    const rest = fund.entries.filter((e) => e.kind !== 'opening');
    return { ...fund, entries: opening === null ? rest : [...rest, { id: 'opening', kind: 'opening', month: null, amountMinor: opening, occurredOn: input.today }] };
  };
  if (!input.existing) {
    const seed = withOpening({ monthlyMinor: 0, startedMonth: month, entries: [] });
    const monthsLeft = Math.max(1, monthsBetween(month, input.dueMonth));
    const openingNow = seed.entries.reduce((sum, e) => sum + e.amountMinor, 0);
    const monthly = input.typedMonthlyMinor ?? recalcMonthly(input.targetMinor - openingNow, monthsLeft, input.currency);
    return { facts: { ...seed, monthlyMinor: monthly }, custom: input.typedMonthlyMinor !== null, plan: null, openingMinor: opening };
  }
  let facts = withOpening(input.existing);
  const latest = sinkingProgress(input.existing, input.targetMinor, input.dueMonth, input.today).monthlyMinor;
  const openingOf = (fund: SinkingFundFacts) => fund.entries.find((e) => e.kind === 'opening')?.amountMinor ?? 0;
  const openingChanged = opening !== undefined && openingOf(facts) !== openingOf(input.existing);
  const targetChanged = input.oldTargetMinor != null && input.oldTargetMinor !== input.targetMinor;
  let custom = input.existingCustom;
  let plan: SinkingSaveResult['plan'] = null;
  if (input.typedMonthlyMinor !== null) {
    custom = true;
    if (input.typedMonthlyMinor !== latest) plan = { from: month > facts.startedMonth ? month : facts.startedMonth, monthlyMinor: input.typedMonthlyMinor };
  } else if (input.existingCustom || targetChanged || openingChanged) {
    custom = false;
    const r = sinkingRecalc(facts, input.targetMinor, input.dueMonth, input.today, input.currency, 'now');
    if (r.monthlyMinor > 0 && r.monthlyMinor !== latest) plan = { from: r.effectiveFrom, monthlyMinor: r.monthlyMinor };
  }
  if (plan) facts = withPlan(facts, plan.from, plan.monthlyMinor);
  return { facts, custom, plan, openingMinor: opening };
}

export interface SinkingHistoryRow {
  kind: 'opening' | 'month' | 'extra';
  /** Sort key, newest first. */
  key: string;
  /** YYYY-MM for a month row; YYYY-MM-DD for the others. */
  date: string;
  /** For a month row: its place among the months, and the months in all. */
  index: number | null;
  monthsTotal: number;
  amountMinor: number;
  skipped: boolean;
  current: boolean;
  entryId: string | null;
}

/** Every entry and every begun month, newest first. Months not begun are not listed. */
export function sinkingHistory(fund: SinkingFundFacts, targetMinor: number, dueMonth: string, today: string): SinkingHistoryRow[] {
  const progress = sinkingProgress(fund, targetMinor, dueMonth, today);
  const rows: SinkingHistoryRow[] = progress.months.map((m) => ({
    kind: 'month',
    key: `${m.month}-01`,
    date: m.month,
    index: m.index,
    monthsTotal: progress.monthsTotal,
    amountMinor: m.amountMinor,
    skipped: m.skipped,
    current: m.current,
    entryId: null,
  }));
  for (const entry of fund.entries) {
    if (entry.kind !== 'opening' && entry.kind !== 'extra') continue;
    rows.push({
      kind: entry.kind,
      key: entry.kind === 'opening' ? `${entry.occurredOn.slice(0, 7)}-00` : entry.occurredOn,
      date: entry.occurredOn,
      index: null,
      monthsTotal: progress.monthsTotal,
      amountMinor: entry.amountMinor,
      skipped: false,
      current: false,
      entryId: entry.id,
    });
  }
  return rows.sort((a, b) => b.key.localeCompare(a.key));
}
