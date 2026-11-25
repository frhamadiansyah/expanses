/*
 * Shared events need every phone in on them to know the seven entities (shared events §7, "App version"; ruling R10).
 * A joiner below this version is refused before it claims anything; a build that predates events altogether refuses the
 * invite itself, by its preview's currency ('XXX').
 */

/** The lowest app version that understands shared events. */
export const SHARED_EVENTS_MIN_APP_VERSION = '0.4.0';

/**
 * The first app version that reads a shared trip's Split costs and Plan switches (0116). An older build applies the
 * event's other fields and passes these over, keeping their clocks: it shows splits and the plan as before, and once it
 * updates it holds neither value. So each phone sends the two again for a device in the event the first time it sees
 * that device at this version or later (sync/repairs.ts, trip switches).
 */
export const TRIP_SWITCHES_MIN_APP_VERSION = '0.5.3';

/**
 * The first app version whose category_needs table takes Debts & savings (0119). An older build's table refuses it by
 * its CHECK, and on a phone that refusal reaches apply without SQLite's code (the worker passes only the message), so
 * apply cannot tell it from a fault and stops the pull at that entry. So a Debts & savings mark is never put in a shared
 * book's log until every other phone in the book says this version or later (capture.ts, `writeChangeSetsTx`); its
 * clock is kept here as if sent, and it goes at that clock once they do (repairs.ts, R7).
 */
/*
 * Ship order: every build that says 0.5.4 must contain migration 0119 — this constant and feat/month-starts-on's
 * MONTH_START_MIN_APP_VERSION go out together in one build (TestFlight 133). A 0.5.4 build without 0119 would be taken
 * for one that can store the mark, and stop on it.
 *
 * Left open: a phone on an older build that joins a book after a Debts & savings mark has already gone into its log
 * (every phone there was at 0.5.4 when it went) stops its pull at that entry, as the hazard above says; nothing is lost
 * and it carries on from there once it updates. Shared books hold two phones today, and TestFlight installs the latest.
 */
export const NEEDS_THIRD_MARK_MIN_APP_VERSION = '0.5.4';

/**
 * The first app version that reads a purchase's `spread` (card instalments C, 0120 and 0121): a purchase its payer's
 * plan counts Each month, which every phone in the book then counts a month at a time, to the same rupiah. An older build
 * would not refuse the field — it takes its clock and drops it — but it would show the purchase whole on its day while
 * the payer's phone spreads it, and repost the purchase for nothing. So, as for the Debts & savings marks, a `spread` is
 * kept out of a shared book's log until every other phone there says this version or later (capture.ts,
 * `writeChangeSetsTx`), its clock kept as if sent, and goes at that clock once they do (repairs.ts, R8).
 *
 * Ship order: every build that says 0.5.5 must contain migrations 0120 and 0121.
 */
export const INSTALMENT_SPREAD_MIN_APP_VERSION = '0.5.5';

const segment = (parts: readonly string[], i: number) => {
  const n = Number(parts[i]);
  return Number.isFinite(n) ? n : 0;
};

/** Whether `have` is at least `want`, release segment by release segment; an unknown version never is. */
export function meetsVersion(have: string | null, want: string): boolean {
  if (have === null) return false;
  const a = have.split('.');
  const b = want.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (segment(a, i) !== segment(b, i)) return segment(a, i) > segment(b, i);
  }
  return true;
}

/**
 * The first app version that knows the plan_spread entity (0123): a card instalment plan with no purchase, counted Each
 * month in a shared workspace. A build before it has no such entity and stops its pull on one (`entityOf` throws), so a
 * plan_spread op is never put in a shared book's log until every other phone there says this version or later
 * (capture.ts, `writeChangeSetsTx`), its clocks kept as if sent; R9 sends it once they do (repairs.ts).
 *
 * Ship order: every build that says 0.5.6 must contain migration 0123.
 */
export const PLAN_SPREAD_MIN_APP_VERSION = '0.5.6';

/**
 * The first app version that reads a purchase's `severalBills` (one payment, several bills; 0127): a purchase that
 * settles two bills or more — one marketplace checkout paying the internet and two phone bills. An older build would
 * not refuse the field — it takes its clock and drops it — and would read only the first bill paid (`bill` or
 * `billLink` still names it), for good. So, as a spread is, `severalBills` is kept out of a shared book's log until
 * every other phone there says this version or later (capture.ts, `writeChangeSetsTx`), its clock kept as if sent, and
 * goes at that clock once they do (repairs.ts, R10).
 *
 * Ship order: every build that says 0.5.7 must contain migration 0127.
 */
export const SEVERAL_BILLS_MIN_APP_VERSION = '0.5.7';

/**
 * The first app version that reads a bill that repeats every few weeks (2026-11-25): the bill's `repeat` is 'weeks'
 * with `repeatEvery` in weeks, and each of its payments is keyed by its day ('YYYY-MM-DD') where every other bill's is
 * keyed by its month. An older build would read the bill as monthly, and would refuse such a payment's day as a bill
 * month (INVALID_BILL_MONTH, skipped): the purchase would be missing on that phone. So a bill is set to repeat by weeks
 * in a shared workspace only while every other phone in it says this version or later (`saveExpenseTemplate`, refused
 * with WEEKS_PHONES_BEHIND, naming them), and a linked device on an older build holds every change of this data
 * version (migration 0128) until it updates.
 *
 * Ship order: every build that says 0.5.8 must contain migration 0128 and bills by weeks.
 *
 * Left open, as for the Debts & savings marks: a phone on an older build that joins a shared workspace after one of its
 * bills went weekly skips that bill's payments until it updates. Shared books hold two phones today.
 */
export const WEEKLY_BILLS_MIN_APP_VERSION = '0.5.8';

/**
 * The first app version that reads a budget by days or weeks the way Budget C counts it (2026-11-25): a month's budget
 * is the amount × the days, the Mondays, or the dates N weeks apart in that month (budget_frequencies.every_weeks and
 * starts_on, 0129). An older build would read a budget every 3 weeks as every week — three times the money — and a day
 * or a week as its average month, so the two phones would judge the same month differently. So a budget is set to
 * repeat by days or weeks in a shared workspace only while every other phone in it says this version or later
 * (`saveBudget`, `saveBudgets`, refused with REPEAT_PHONES_BEHIND, naming them), and a linked device on an older build
 * holds every change of this data version (migration 0129) until it updates.
 *
 * Ship order: rides 0.5.8 with bills by weeks, so every build that says 0.5.8 must contain migration 0129 and Budget C as
 * well as 0128. Should a 0.5.8 build go out without them, this becomes 0.5.9 (and the web app's version with it).
 */
export const BUDGET_REPEAT_MIN_APP_VERSION = '0.5.8';
