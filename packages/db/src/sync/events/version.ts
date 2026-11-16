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
