import type { NewTransactionSearch } from '../transactions/new-search';

/*
 * Event mode's words and its one rule about forms (owner, 12 Nov 2026; mockup docs/mockups/2026-11-12-event-mode.html).
 * The mode itself — what is stored, when it is on, Keep on — is the database package's (`repos/event-mode.ts`).
 */

/** The mark every place names an event by: the chip, the menu's top row, a row's grey line. */
export const EVENT_MARK = '✈️';

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
/** The start of a row's grey line when the row is in an event. */
export const rowEventLead = (eventName: string) => `${EVENT_MARK} ${eventName}`;

/**
 * Which ways into the Add screen open with the event already set: every new transaction that is spending — the tab
 * bar's ＋, an account's Spend — but not one that names its own event or plan item, a shared expense being edited, a
 * partner's item, a trade, money received or a transfer.
 */
export function opensInEventMode(search: Pick<NewTransactionSearch, 'mode' | 'event' | 'item' | 'expense' | 'partner' | 'to'>): boolean {
  if (search.event || search.item || search.expense || search.partner || search.to) return false;
  return search.mode === undefined || search.mode === 'expense';
}
