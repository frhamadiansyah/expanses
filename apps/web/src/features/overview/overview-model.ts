import { addMonths, monthYear } from '@expanses/core';

/*
 * The wide screen's Overview, option A of the Mac Overview mockup (2026-11-17). Every figure here is one the app already
 * works out elsewhere, put side by side; nothing is guessed. The page (OverviewPage.tsx) reads them and this file only
 * arranges them, so each rule is tested on its own with invented numbers.
 */

/** One month of the chart: a past or current month's spending, or an expected one ahead. */
export interface ChartMonth {
  month: string;
  /** What was spent (past and current months), or what is expected (months ahead). Null: not read yet. */
  minor: number | null;
  kind: 'spent' | 'highest' | 'expected';
  /** The month-end balance the dotted line passes through; only for months ahead (see `projectedBalance`). */
  balanceMinor: number | null;
}

/** Where Expected comes from: the month's budget total when a budget is set, else the last three full months' average. */
export type ExpectedSource = { kind: 'budget'; minor: number } | { kind: 'average'; minor: number } | { kind: 'none' };

/** The average of what is known, rounded to a minor unit; null when nothing is. */
export function averageOf(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number');
  return known.length === 0 ? null : Math.round(known.reduce((sum, value) => sum + value, 0) / known.length);
}

export function expectedSpending(budgetTotalMinor: number | null, lastThreeSpent: readonly (number | null)[]): ExpectedSource {
  if (budgetTotalMinor !== null && budgetTotalMinor > 0) return { kind: 'budget', minor: budgetTotalMinor };
  const average = averageOf(lastThreeSpent);
  return average === null ? { kind: 'none' } : { kind: 'average', minor: average };
}

export function expectedLegend(source: ExpectedSource): string {
  if (source.kind === 'budget') return 'Expected: the monthly budget';
  if (source.kind === 'average') return 'Expected: average of the last 3 months';
  return 'Expected: nothing to go on yet';
}

/**
 * The twelve months the chart draws, starting at `first`: months up to `current` are what was spent (the highest of
 * them marked), later ones what is expected, each with the projected month-end balance.
 */
export function chartMonths(input: {
  first: string;
  current: string;
  spent: Readonly<Record<string, number | null>>;
  expected: ExpectedSource;
  balanceAhead: (monthsAhead: number) => number | null;
}): ChartMonth[] {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(input.first, i));
  const pastValues = months.filter((month) => month <= input.current).map((month) => input.spent[month] ?? null);
  const top = Math.max(0, ...pastValues.filter((value): value is number => value !== null));
  let marked = false;
  return months.map((month) => {
    if (month <= input.current) {
      const minor = input.spent[month] ?? null;
      const highest = !marked && minor !== null && minor > 0 && minor === top;
      if (highest) marked = true;
      return { month, minor, kind: highest ? 'highest' : 'spent', balanceMinor: null };
    }
    const ahead = monthsBetween(input.current, month);
    return { month, minor: input.expected.kind === 'none' ? null : input.expected.minor, kind: 'expected', balanceMinor: input.balanceAhead(ahead) };
  });
}

/** How many whole months `later` is after `earlier` (both YYYY-MM). */
export function monthsBetween(earlier: string, later: string): number {
  const [ey, em] = earlier.split('-').map(Number) as [number, number];
  const [ly, lm] = later.split('-').map(Number) as [number, number];
  return (ly - ey) * 12 + (lm - em);
}

/**
 * The dotted line ahead: today's money on hand plus, for each month ahead, the last three full months' average income
 * less their average spending. Null when any of the three is unknown — the line is then not drawn.
 */
export function projectedBalance(onHandMinor: number | null, averageIncome: number | null, averageSpent: number | null): (monthsAhead: number) => number | null {
  return (monthsAhead) => (onHandMinor === null || averageIncome === null || averageSpent === null ? null : onHandMinor + (averageIncome - averageSpent) * monthsAhead);
}

/** "Jun 2026 – May 2027": the range in the title bar. */
export function rangeLabel(first: string): string {
  return `${monthYear(first)} – ${monthYear(addMonths(first, 11))}`;
}

/** The window's first month: six months shown up to and including the current one, moved by `shift` months. */
export function firstMonth(current: string, shift: number): string {
  return addMonths(current, -5 + shift);
}

export interface Lasts {
  /** Whole and tenths of months the money on hand covers at the average spending; null with nothing to divide by. */
  months: number | null;
  /** "Mar 2027": the month it runs out in. */
  until: string | null;
  /** 0..1 of the target, for the gauge. */
  share: number;
}

/** How long it lasts: money on hand over the last three full months' average spending, against the target months. */
export function howLongItLasts(onHandMinor: number | null, averageSpent: number | null, targetMonths: number, current: string): Lasts {
  if (onHandMinor === null || averageSpent === null || averageSpent <= 0) return { months: null, until: null, share: 0 };
  const months = Math.max(0, onHandMinor) / averageSpent;
  const rounded = Math.round(months * 10) / 10;
  return { months: rounded, until: monthYear(addMonths(current, Math.floor(months))), share: Math.min(1, months / Math.max(1, targetMonths)) };
}

/** "4,2 mo": the gauge's figure. */
export function monthsText(months: number): string {
  return `${months.toLocaleString('id-ID', { maximumFractionDigits: 1 })} mo`;
}

/** The emergency target the gauge measures against: the household's emergency goal's months, else six. */
export function targetMonths(goalMonths: number | null): number {
  return goalMonths !== null && goalMonths > 0 ? goalMonths : 6;
}

export interface AccountBar {
  id: string;
  name: string;
  minor: number | null;
  currency: string;
  /** 0..1 of the largest account, compared in the base currency. */
  share: number;
}

/** Each money account with a bar as long as its share of the largest (compared in the base currency); largest first. */
export function accountBars(rows: readonly { id: string; name: string; minor: number | null; currency: string; baseMinor: number | null }[]): AccountBar[] {
  const largest = Math.max(0, ...rows.map((row) => row.baseMinor ?? 0));
  return [...rows]
    .sort((a, b) => (b.baseMinor ?? -Infinity) - (a.baseMinor ?? -Infinity))
    .map((row) => ({ id: row.id, name: row.name, minor: row.minor, currency: row.currency, share: largest > 0 && row.baseMinor !== null ? Math.max(0, row.baseMinor) / largest : 0 }));
}

export interface LookItem {
  key: 'review' | 'late' | 'over' | 'bills' | 'backup';
  title: string;
  detail: string;
  to: string;
}

/**
 * Worth a look: only what the app already counts, most pressing first, at most three. Nothing to show is a calm empty
 * box on the page, not a made-up item.
 */
export function worthALook(input: { review: number; late: number; over: number; billsSoon: number; backupDays: number | null; hasData: boolean }): LookItem[] {
  const items: LookItem[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (input.late > 0) items.push({ key: 'late', title: `${plural(input.late, 'debt', 'debts')} late`, detail: 'Past the due date on the Debt-free plan.', to: '/net-worth/plan' });
  if (input.billsSoon > 0) items.push({ key: 'bills', title: `${plural(input.billsSoon, 'bill', 'bills')} due within 3 days`, detail: 'Overdue or due soon on Bills.', to: '/bills' });
  if (input.review > 0) items.push({ key: 'review', title: `${plural(input.review, 'purchase', 'purchases')} to review`, detail: 'Captured, not filed yet.', to: '/review' });
  if (input.over > 0) items.push({ key: 'over', title: `${plural(input.over, 'budget category', 'budget categories')} over`, detail: 'Spent past the budget this month.', to: '/budget' });
  if (input.hasData && (input.backupDays === null || input.backupDays >= 7))
    items.push({ key: 'backup', title: input.backupDays === null ? 'Never backed up' : `Last backup ${input.backupDays} days ago`, detail: 'The only copy is on this device.', to: '/backup' });
  return items.slice(0, 3);
}

export interface Upcoming {
  key: string;
  dueOn: string;
  title: string;
  minor: number | null;
  currency: string;
  /** Money coming in (drawn green with a +); nothing of the kind is recorded today, see OverviewPage. */
  incoming: boolean;
}

/** The next 14 days: what is not yet paid and falls due from today to 14 days on, soonest first. */
export function nextFortnight<T extends { key: string; dueOn: string; status: 'paid' | 'late' | 'upcoming'; title: string; minor: number | null; currency: string }>(items: readonly T[], today: string): Upcoming[] {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 14);
  const last = end.toISOString().slice(0, 10);
  const seen = new Set<string>();
  return items
    .filter((item) => item.status !== 'paid' && item.dueOn >= today && item.dueOn <= last)
    .filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title))
    .map((item) => ({ key: item.key, dueOn: item.dueOn, title: item.title, minor: item.minor, currency: item.currency, incoming: false }));
}
