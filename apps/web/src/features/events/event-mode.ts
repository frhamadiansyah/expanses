import type { NewTransactionSearch } from '../transactions/new-search';
import { pageLocks } from './shared-view';

/*
 * Event mode's words and its one rule about forms (owner, 12 Nov 2026; mockup docs/mockups/2026-11-12-event-mode.html).
 * The mode itself — what is stored, when it is on, Keep on — is the database package's (`repos/event-mode.ts`).
 */

/** "20 Nov": the short day the switch's footer, the menu row and the toast name. */
export function shortDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const modeHint = (eventName: string) => `New transactions go to ${eventName}`;
export const modeFooter = (until: string) => `Ends by itself after ${shortDay(until)}. Turning it on for another event turns this one off.`;
export const menuLine = (until: string) => `Event mode until ${shortDay(until)}`;
export const endedText = (eventName: string) => `Event mode for ${eventName} ended`;
/** Under the Add form's chip for a shared event: who will see what is saved into it. */
export const sharedWithLine = (names: readonly string[]) => `Shared with ${names.join(', ')}`;

/**
 * Which ways into the Add screen open with the event already set: every new transaction that is spending — the tab
 * bar's ＋, an account's Spend — but not one that names its own event or plan item, a shared expense being edited, a
 * partner's item, a trade, money received or a transfer.
 */
export function opensInEventMode(search: Pick<NewTransactionSearch, 'mode' | 'event' | 'item' | 'expense' | 'partner' | 'to' | 'pay'>): boolean {
  if (search.event || search.item || search.expense || search.partner || search.to || search.pay) return false;
  return search.mode === undefined || search.mode === 'expense';
}

/**
 * The currency a form opens in for event mode, or null to leave it to what pays (fix round 1, M4): only when "Add in" is
 * another currency than the workspace's, or the event has one of its own — a rupiah trip does not pin rupiah on a form
 * paid from a dollar account.
 */
export function addInCurrency(active: { mode: { currency: string }; event: { currency: string | null } } | null, baseCurrency: string): string | null {
  if (!active) return null;
  return active.mode.currency !== baseCurrency || active.event.currency ? active.mode.currency : null;
}

/**
 * Whether event mode fills in a new transaction here. A shared workspace's spending takes no private event (sync gaps
 * D1: the tag would stay on this phone alone), so there only a shared event — which the purchase moves into — applies.
 */
export function eventModeApplies(active: { shared: unknown } | null, bookShared: boolean): boolean {
  return !!active && (!!active.shared || !bookShared);
}

/**
 * The event One line and Paste a list tag with (fix round 2): none while the mode is still being read — the
 * shared events among them decide how it posts, so One line and Paste a list wait rather than tag a shared event as a
 * private one — none once ✕ left it out, and none where it does not apply.
 */
export function formEvent<T extends { shared: unknown }>(
  state: { ready: boolean; active: T | null },
  leftOut: boolean,
  bookShared: boolean,
): { waiting: boolean; active: T | null } {
  if (!state.ready) return { waiting: true, active: null };
  return { waiting: false, active: !leftOut && eventModeApplies(state.active, bookShared) ? state.active : null };
}

/**
 * Whether a captured draft's row names its event (fix round 2): a private event never reaches a shared workspace's
 * spending (sync gaps D1, the capture records in none there), so its row does not claim it; a shared event, which the
 * draft moves into on its form, is named.
 */
export function draftShowsEvent(eventId: string | null | undefined, sharedEvents: Readonly<Record<string, unknown>>, bookShared: boolean): boolean {
  return !!eventId && (!bookShared || !!sharedEvents[eventId]);
}

/**
 * Whether a shared event still takes event mode: one that is Done, left, or no longer shared here takes nothing new
 * (fix round 1, M3). An event that is not shared (no view) always does.
 */
export function takesEventMode(view: { state: string; finishedAt: string | null } | null | undefined): boolean {
  return !view || !pageLocks(view).locked;
}
