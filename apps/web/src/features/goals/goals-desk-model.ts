import { formatMinor, type GoalKind, type RankFit } from '@expanses/core';
import { bareFigure } from '../networth/debt-rows';
import { monthYear } from './goal-cards';

/*
 * Mac Goals (redesign step 10): the figures the wide page draws that the phone says in words. Nothing here works money
 * out: where saving goes reads `summary.fits` (`fitByRank`, the phone's own fit), the timeline reads each goal's date and
 * the card's own progress.
 */

// ── Where saving goes ───────────────────────────────────────────────────────────────────────────────────────────────

/** One goal as the chart reads it: its monthly need in the base money (what `fitByRank` was given) and its fit. */
export interface SavingRow {
  goalId: string;
  name: string;
  kind: GoalKind;
  /** Its need a month in the base money: the plan's `ownNeededMonthlyBaseMinor`, the figure the fit was worked from. */
  neededMinor: number;
  /** What of that the month's saving reaches, in goal order (`RankFit.fundedMonthlyMinor`). */
  fundedMinor: number;
  fits: RankFit['fits'];
}

/**
 * The chart's rows, in the fit's own order (goal order: compulsory first, each section by rank): every goal still running
 * that needs something a month. A done goal, or one that needs nothing more, takes no part of the month's saving.
 */
export function savingRows(
  fits: readonly RankFit[],
  goals: readonly { goalId: string; name: string; kind: GoalKind; neededBaseMinor: number | null; done: boolean }[],
): SavingRow[] {
  const byId = new Map(goals.map((goal) => [goal.goalId, goal]));
  return fits.flatMap((fit) => {
    const goal = byId.get(fit.goalId);
    if (!goal || goal.done) return [];
    const neededMinor = goal.neededBaseMinor ?? 0;
    if (neededMinor <= 0) return [];
    return [{ goalId: fit.goalId, name: goal.name, kind: goal.kind, neededMinor, fundedMinor: fit.fundedMonthlyMinor, fits: fit.fits }];
  });
}

/** A row's own words: "fits in full", "gets Rp 600.000 of 2.720.000", "waits". */
export function fitText(row: Pick<SavingRow, 'fits' | 'fundedMinor' | 'neededMinor'>, currency: string): string {
  if (row.fits === 'full') return 'fits in full';
  if (row.fits === 'partial') return `gets ${formatMinor(row.fundedMinor, currency)} of ${bareFigure(row.neededMinor, currency)}`;
  return 'waits';
}

/** The box's one grey line, in goal order: "In goal order, 4 fit in full, Japan in part, Car waits." */
export function fitLine(rows: readonly Pick<SavingRow, 'name' | 'fits'>[]): string | null {
  if (rows.length === 0) return null;
  const full = rows.filter((row) => row.fits === 'full').length;
  const partial = rows.filter((row) => row.fits === 'partial');
  const none = rows.filter((row) => row.fits === 'none');
  if (partial.length === 0 && none.length === 0) return rows.length === 1 ? 'The one goal fits in full.' : `In goal order, all ${rows.length} fit in full.`;
  const parts: string[] = [];
  if (full > 0) parts.push(`${full} ${full === 1 ? 'fits' : 'fit'} in full`);
  for (const row of partial) parts.push(`${row.name} in part`);
  if (none.length === 1) parts.push(`${none[0]!.name} waits`);
  else if (none.length > 1) parts.push(`${none.length} wait`);
  return `In goal order, ${parts.join(', ')}.`;
}

/** One goal's piece of the stacked bar, as shares of the bar's whole width. */
export interface SavingPiece {
  goalId: string;
  kind: GoalKind;
  from: number;
  width: number;
}

/**
 * The stacked bar: each goal's need a month laid end to end in goal order, a line where the month's saving reaches,
 * and the part past it (what is short) hatched. The bar's width is the larger of the two, so the line is always on it.
 */
export function savingBar(rows: readonly Pick<SavingRow, 'goalId' | 'kind' | 'neededMinor'>[], savedMinor: number): { pieces: SavingPiece[]; line: number; short: { from: number; width: number } | null } {
  const total = rows.reduce((sum, row) => sum + row.neededMinor, 0);
  const whole = Math.max(total, Math.max(0, savedMinor));
  if (whole <= 0) return { pieces: [], line: 0, short: null };
  let at = 0;
  const pieces = rows.map((row) => {
    const piece = { goalId: row.goalId, kind: row.kind, from: at / whole, width: row.neededMinor / whole };
    at += row.neededMinor;
    return piece;
  });
  const line = Math.max(0, savedMinor) / whole;
  return { pieces, line, short: total > savedMinor ? { from: line, width: 1 - line } : null };
}

// ── When each goal is due ───────────────────────────────────────────────────────────────────────────────────────────

/** How far ahead the axis may reach for a goal's date; a goal further off runs past its edge ("→ Jan 2051"). */
export const AXIS_YEARS = 10;

export interface Lane {
  goalId: string;
  name: string;
  kind: GoalKind;
  dueLabel: string;
  /** Where the date sits on the axis, 0 (today) to 1 (its end); null for a date past the end. */
  at: number | null;
  /** How far the filled part reaches, 0 to 1 of the axis: the goal's progress along its own track (today → its date). */
  fill: number;
  behind: boolean;
}

export interface Axis {
  /** The axis's last day: 1 January of the year after the latest date within reach. */
  end: string;
  /** The years named under it, each at its place on the axis (today is named at 0). */
  ticks: { label: string; at: number }[];
}

const DAY = 86_400_000;
const daysFrom = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY;

/** The axis from today: to the year after the latest date within `AXIS_YEARS`, two years at least, a tick each year or two. */
export function timelineAxis(dueDates: readonly string[], today: string): Axis {
  const thisYear = Number(today.slice(0, 4));
  const reach = `${thisYear + AXIS_YEARS}${today.slice(4)}`;
  const within = dueDates.filter((due) => due <= reach).sort();
  const latest = within.at(-1);
  const endYear = Math.max(thisYear + 2, latest ? Number(latest.slice(0, 4)) + 1 : thisYear + 2);
  const end = `${endYear}-01-01`;
  const span = endYear - thisYear;
  const step = span <= 4 ? 1 : span <= 8 ? 2 : Math.ceil(span / 4);
  const total = daysFrom(today, end);
  const ticks: { label: string; at: number }[] = [];
  for (let year = thisYear + 1; year <= endYear; year++) if ((endYear - year) % step === 0) ticks.push({ label: String(year), at: daysFrom(today, `${year}-01-01`) / total });
  return { end, ticks };
}

/**
 * Each goal's lane on the axis: its date's place (null past the end), and the part filled — its progress (the card's,
 * paid payments included) along its own track from today to its date, so a lane past the edge is filled on the same scale.
 */
export function timelineLanes(
  goals: readonly { goalId: string; name: string; kind: GoalKind; dueOn: string; progress: number; behind: boolean }[],
  axis: Pick<Axis, 'end'>,
  today: string,
): Lane[] {
  const total = daysFrom(today, axis.end);
  return goals.map((goal) => {
    const due = Math.max(0, daysFrom(today, goal.dueOn)) / total;
    const progress = Math.max(0, Math.min(1, goal.progress));
    return {
      goalId: goal.goalId,
      name: goal.name,
      kind: goal.kind,
      dueLabel: monthYear(goal.dueOn),
      at: goal.dueOn > axis.end ? null : due,
      fill: Math.min(1, due * progress),
      behind: goal.behind,
    };
  });
}

/** The day a goal finishes, as its card reads it (`goalCard`'s due): the last stage still to pay, else its last stage. */
export function finishOn(stages: readonly { dueOn: string; state: string }[]): string | null {
  const unpaid = stages.filter((stage) => stage.state !== 'paid');
  return (unpaid.at(-1) ?? stages.at(-1))?.dueOn ?? null;
}

// ── The chart box's two pages ───────────────────────────────────────────────────────────────────────────────────────

/** The chart box's pages, in order: where the month's saving goes, then when each goal is due. */
export const CHART_PAGES = ['saving', 'due'] as const;
export type ChartPage = (typeof CHART_PAGES)[number];
export const CHART_PAGE_KEY = 'goals.desk-chart';

/** The page shown last on this device (one device's choice, never synced); the first page when none was kept. */
export function readChartPage(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): ChartPage {
  try {
    return storage?.getItem(CHART_PAGE_KEY) === 'due' ? 'due' : 'saving';
  } catch {
    return 'saving';
  }
}

export function writeChartPage(page: ChartPage, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (page === 'saving') storage?.removeItem(CHART_PAGE_KEY);
    else storage?.setItem(CHART_PAGE_KEY, page);
  } catch {
    /* Not remembered: the page still turns for this visit. */
  }
}

/** The page one step along (`by` −1 or 1), or the same page at either end: two pages, no wrapping round. */
export function stepPage(page: ChartPage, by: number): ChartPage {
  const at = CHART_PAGES.indexOf(page) + Math.sign(by);
  return CHART_PAGES[Math.max(0, Math.min(CHART_PAGES.length - 1, at))]!;
}

/** How far a two-finger swipe has to travel sideways before the page turns. */
export const SWIPE_DISTANCE = 40;

/**
 * A two-finger swipe, as wheel events: the sideways distance gathered so far, and whether it now turns the page (1 to
 * the next — fingers moving left, as a trackpad sends it with a positive deltaX — −1 to the one before, 0 not yet).
 */
export function swipeStep(gathered: number): -1 | 0 | 1 {
  if (gathered >= SWIPE_DISTANCE) return 1;
  if (gathered <= -SWIPE_DISTANCE) return -1;
  return 0;
}
