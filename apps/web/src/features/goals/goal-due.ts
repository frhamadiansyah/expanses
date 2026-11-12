import { dayMonth, formatMinor, monthName, ordinal } from '@expanses/core';
import type { GoalDue, GoalDueMode, GoalDueMonth, GoalDueSettings } from '@expanses/db';

/*
 * A goal's Monthly that comes due like a bill (owner, 12 Nov 2026; mockup 2026-11-12-goal-monthly-like-bill, screens
 * 1–4): the words and figures the Monthly sheet, the Recurring page's "Goals this month", the month's sheet and the
 * goal page's Month history draw, worked out here so they can be tested without a screen.
 */

/** The day picker's "Last day", as the database keeps it. */
export const LAST_DAY = 31;

/** The day picker: the 1st to the 28th, then Last day — every month has those. */
export const DUE_DAYS: readonly { value: number; label: string }[] = [
  ...Array.from({ length: 28 }, (_, index) => ({ value: index + 1, label: ordinal(index + 1) })),
  { value: LAST_DAY, label: 'Last day' },
];

/** "25th", or "Last day" for a day past the 28th. */
export const dueDayLabel = (day: number) => (day > 28 ? 'Last day' : ordinal(day));

/** "the 25th", or "the last day". */
const theDay = (day: number) => (day > 28 ? 'the last day' : `the ${ordinal(day)}`);

/** The accounts the Monthly sheet starts on when Due each month is first turned on. */
export function dueDefaults(
  accounts: readonly { id: string; subtype: string }[],
  setAsideIn: readonly string[],
): { day: number; accountId: string | null; toAccountId: string | null } {
  // No expected income in the app carries a payday, so the 1st.
  const accountId = setAsideIn[0] ?? accounts[0]?.id ?? null;
  return { day: 1, accountId, toAccountId: toDefault(accounts, accountId) };
}

/**
 * Transfer's From: an account where the goal has nothing set aside, when there is one — a month is new money for the
 * goal, and money already promised to it moved elsewhere adds nothing. Else the account already chosen.
 */
export function transferFromDefault(accounts: readonly { id: string }[], held: readonly string[], current: string | null): string | null {
  if (current && !held.includes(current)) return current;
  return accounts.find((account) => !held.includes(account.id))?.id ?? current ?? accounts[0]?.id ?? null;
}

/** Undo, or a lowered amount, that could not take all of it back: what it did take, and why the rest stayed. */
export const shortTakeBackText = (takenText: string) => `Only ${takenText} could be taken back: the rest was moved or used since.`;

/**
 * A Transfer month past From's free money: what of it was already set aside for the goal there, and so moves the goal's
 * promise rather than adding to it. Null when the free money covers it, or the goal has nothing there.
 */
export function alreadySetAside(o: { amountMinor: number | null; freeMinor: number; ownPromiseMinor: number }): number | null {
  if (o.amountMinor === null || o.amountMinor <= 0) return null;
  const past = o.amountMinor - Math.max(0, o.freeMinor);
  const moved = Math.min(Math.max(0, past), o.ownPromiseMinor);
  return moved > 0 ? moved : null;
}

/** "Rp 500.000 of this was already set aside for Umrah." */
export const alreadySetAsideText = (amountText: string, goalName: string) => `${amountText} of this was already set aside for ${goalName}.`;

/** Offline, with no rate stored for a goal's own currency: what a Transfer month says. */
export const noRateText = (currency: string) => `No rate for ${currency} yet: connect to the internet once, or record the transfer from Add.`;

/** Transfer's To: a savings account other than From, else any other account. */
export function toDefault(accounts: readonly { id: string; subtype: string }[], fromId: string | null): string | null {
  const others = accounts.filter((account) => account.id !== fromId);
  return (others.find((account) => account.subtype === 'savings') ?? others[0])?.id ?? null;
}

/**
 * The Monthly sheet's footer under the Due group: "Comes due on the 25th, like a bill. Set aside keeps the money in
 * BCA Tahapan, promised to Hajj; Transfer moves it to another account." A Transfer goal names its two accounts.
 */
export function monthlyFooter(o: { day: number; mode: GoalDueMode; goalName: string; inName: string | null; toName: string | null }): string {
  const head = `Comes due on ${theDay(o.day)}, like a bill.`;
  const keeps = o.inName ? `Set aside keeps the money in ${o.inName}, promised to ${o.goalName}` : `Set aside keeps the money in its account, promised to ${o.goalName}`;
  const moves = o.mode === 'transfer' && o.toName ? `Transfer moves it to ${o.toName}` : 'Transfer moves it to another account';
  return `${head} ${keeps}; ${moves}.`;
}

/** The goal page's Monthly row, under its name: "Due on the 25th · Set aside in BCA Tahapan". Null while off. */
export function monthlySubtitle(settings: GoalDueSettings | null, nameOf: (accountId: string | null) => string): string | null {
  if (!settings?.active) return null;
  const how = settings.mode === 'transfer' ? `Transfer to ${nameOf(settings.toAccountId)}` : `Set aside in ${nameOf(settings.accountId)}`;
  return `Due on ${theDay(settings.day)} · ${how}`;
}

/** "Hajj · November": the month's sheet title, and what each Undo bar names. */
export const dueTitle = (goalName: string, month: string) => `${goalName} · ${monthName(month, 'long')}`;

/** The light Undo bar after a tap on a month. */
export function dueToast(kind: 'set_aside' | 'transfer' | 'skipped', goalName: string, month: string): string {
  if (kind === 'skipped') return `Skipped ${dueTitle(goalName, month)}`;
  return `${kind === 'transfer' ? 'Transferred' : 'Set aside'} for ${dueTitle(goalName, month)}`;
}

/** What the month's sheet says under its rows. */
export function dueSheetFooter(o: { mode: GoalDueMode; amountText: string; goalName: string; fromName: string; toName: string }): string {
  if (o.mode === 'set_aside') return `Nothing leaves the account: ${o.amountText} moves from Free to spend to Set aside for ${o.goalName}.`;
  return `${o.amountText} moves from ${o.fromName} to ${o.toName}, for ${o.goalName}.`;
}

export interface GoalLine {
  goalId: string;
  name: string;
  kind: string;
  currency: string;
}

/** One goal's row in Recurring's "Goals this month". */
export interface GoalDueLine {
  goalId: string;
  name: string;
  kind: string;
  currency: string;
  month: GoalDueMonth;
  /** "25 Nov · Rp 2.000.000". */
  subtitle: string;
  /** The button an open month has: what the goal does. Null once done or skipped. */
  action: 'Set aside' | 'Transfer' | null;
  /** What a done or skipped month says in the button's place. */
  status: '✓ Set aside' | '✓ Transferred' | 'Skipped' | null;
}

/**
 * Recurring's "Goals this month": one row per goal with this month due, in the goals' own order, and the header's
 * total — every row's amount, done, open or skipped, per currency. Earlier open months are not here: they wait in the
 * goal's Month history.
 */
export function goalsThisMonth(dues: readonly GoalDue[], goals: readonly GoalLine[], today: string): { lines: GoalDueLine[]; totals: { currency: string; amountMinor: number }[] } {
  const month = today.slice(0, 7);
  const lines: GoalDueLine[] = [];
  for (const goal of goals) {
    const due = dues.find((row) => row.settings.goalId === goal.goalId);
    const current = due?.months.find((row) => row.month === month);
    if (!current) continue;
    lines.push({
      goalId: goal.goalId,
      name: goal.name,
      kind: goal.kind,
      currency: goal.currency,
      month: current,
      subtitle: `${dayMonth(current.dueOn)} · ${formatMinor(current.amountMinor, goal.currency)}`,
      action: current.state === 'open' ? (current.mode === 'transfer' ? 'Transfer' : 'Set aside') : null,
      status: current.state === 'skipped' ? 'Skipped' : current.state === 'done' ? (current.mode === 'transfer' ? '✓ Transferred' : '✓ Set aside') : null,
    });
  }
  const totals: { currency: string; amountMinor: number }[] = [];
  for (const line of lines) {
    const found = totals.find((total) => total.currency === line.currency);
    if (found) found.amountMinor += line.month.amountMinor;
    else totals.push({ currency: line.currency, amountMinor: line.month.amountMinor });
  }
  return { lines, totals };
}

/** One month in the goal page's Month history. */
export interface MonthHistoryLine {
  month: GoalDueMonth;
  /** "November", or "November 2025" for a month of another year. */
  title: string;
  /** "Set aside 25 Nov · BCA Tahapan", "Transferred 1 Nov · Tabungan", "Skipped" or "Open". */
  subtitle: string;
  /** The amount, or "—" for a skipped month. */
  value: string;
}

/** The goal page's Month history, newest first, as the months come. */
export function monthHistory(months: readonly GoalDueMonth[], currency: string, nameOf: (accountId: string | null) => string, today: string): MonthHistoryLine[] {
  return months.map((month) => {
    const title = month.month.slice(0, 4) === today.slice(0, 4) ? monthName(month.month, 'long') : `${monthName(month.month, 'long')} ${month.month.slice(0, 4)}`;
    const day = month.occurredOn ? dayMonth(month.occurredOn) : '';
    const subtitle =
      month.state === 'skipped'
        ? 'Skipped'
        : month.state === 'open'
          ? 'Open'
          : month.mode === 'transfer'
            ? `Transferred ${day} · ${nameOf(month.toAccountId)}`
            : `Set aside ${day} · ${nameOf(month.accountId)}`;
    return { month, title, subtitle, value: month.state === 'skipped' ? '—' : formatMinor(month.amountMinor, currency) };
  });
}
