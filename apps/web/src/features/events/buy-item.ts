import { minorToMajorString } from '@expanses/core';
import { EventError } from '@expanses/db';
import { type FormDraft, isRefund } from '../transactions/tx-form';

/**
 * Where an event's "Add spending" goes: the ordinary Add screen, in Expense, with the Event row already set.
 *
 * The event page used to carry an Add spending form of its own — Date, Description, Paid with, Category, Amount —
 * which was a second, smaller copy of the one screen every transaction is recorded on. The Add screen already takes
 * an event (§4's Event row), and `formToPost` already posts it, so the copy only ever lost what the screen has: the
 * keypad, the note's category guess, a card, a split, Photos. Save and Back go back to the event, the way they go
 * back to whatever opened the screen.
 */
export function addSpendingTarget(eventId: string, carried: { amount?: string; currency?: string; note?: string; date?: string } = {}) {
  return { to: '/transactions/new' as const, search: { event: eventId, ...carried } };
}

/**
 * What the workspace card already holds when a shared event is picked on its Event row: the amount, currency, note and
 * date, only the ones filled in, so the shared card opens with them rather than empty.
 */
export function carriedFromDraft(draft: { amount: string; currency: string; description: string; occurredOn: string }): { amount?: string; currency?: string; note?: string; date?: string } {
  const amount = draft.amount.trim();
  const note = draft.description.trim();
  return {
    ...(amount ? { amount, currency: draft.currency } : {}),
    ...(note ? { note } : {}),
    ...(draft.occurredOn ? { date: draft.occurredOn } : {}),
  };
}

/**
 * Where "Buy it now" goes: the same Add screen, filled in from the item, and the item named so Save can tie the
 * payment to what it answered (`linkEventItem`, with the id the save posted). `ws` is the workspace tab the plan was
 * being read in, carried so the plan screen Save lands on keeps reading in it — never where the payment is filed,
 * which is the open workspace, as it is for every transaction.
 */
export function buyTarget(eventId: string, itemId: string, ws?: string) {
  return { to: '/transactions/new' as const, search: { event: eventId, item: itemId, ws } };
}

/**
 * Where a receipt that is already spoken for is answered.
 *
 * "What it covers" is the one screen on which several items are set against one payment, every share typed together
 * and checked against the receipt before anything is written. Anything that cannot claim a receipt on its own is
 * carried here with the item it was trying to answer, rather than told in words where to go.
 */
export function coverTarget(eventId: string, transactionId: string, options: { item?: string; ws?: string } = {}) {
  return {
    to: '/events/$eventId/plan/link/$transactionId' as const,
    params: { eventId, transactionId },
    search: { ws: options.ws, item: options.item },
  };
}

/**
 * The one refusal a screen can route rather than merely print.
 *
 * `NOTHING_LEFT` does not mean the tick was wrong: ticking an item off claims what is left of its receipt, so the
 * second tick on a receipt that answers several items finds nothing there. That is the ordinary shape of a shopping
 * trip, not a mistake, and its answer is a screen rather than a sentence.
 */
export const isNothingLeft = (error: unknown) => error instanceof EventError && error.code === 'NOTHING_LEFT';

/** What "Buy it now" needs of a plan item: what it is called, what it was expected to cost, where it was planned. */
export interface BuyingItem {
  id: string;
  name: string;
  estimateMinor: number;
  categoryId: string | null;
}

/**
 * What the Add screen opens on when an address names an event, and perhaps one of its items.
 *
 * Only what this device holds: an event that is not here (deleted on another phone, or a link kept from another
 * owner) fills nothing in, exactly as `seedIds` treats an account it does not know — the screen opens as the tab
 * bar's ＋ opens it rather than refusing. An item is looked for in *that event's* plan, so an item id carried with
 * the wrong event buys nothing rather than tying a payment to an occasion it was not tagged to. And an item without
 * an event is nothing at all: the event is what the payment is tagged to, and the link needs the tag.
 */
export function eventOpening(
  ask: { event?: string; item?: string },
  events: readonly { id: string }[],
  items: readonly BuyingItem[],
): { eventId: string; item: BuyingItem | null } | null {
  if (!ask.event || !events.some((event) => event.id === ask.event)) return null;
  const item = ask.item ? (items.find((row) => row.id === ask.item) ?? null) : null;
  return { eventId: ask.event, item };
}

/**
 * The fields an item fills in: its name as the note, its estimate as the amount, its category.
 *
 * The estimate is the owner's money (the plan is read in the base currency), typed as the amount row types it, so
 * the figure that opens is the one the item page printed. It is only a start — the receipt rarely says exactly what
 * the plan guessed — and the screen says so. A category the item does not name is left for the screen to ask.
 */
export function buySeed(item: BuyingItem, baseCurrency: string): { description: string; amount: string; categoryId?: string } {
  return {
    description: item.name,
    amount: minorToMajorString(item.estimateMinor, baseCurrency),
    ...(item.categoryId ? { categoryId: item.categoryId } : {}),
  };
}

/**
 * Why Save may not buy the item with this draft, asked before a rupiah is written — or null when it may.
 *
 * The link that follows the payment can refuse, and the payment cannot be taken back, so everything the link would
 * refuse is refused here instead. A share is a whole figure above nought, so buying a thing for money coming back
 * posted the payment, tagged it, and only then failed with the repository's own words about shares — leaving behind
 * a transaction the user never got the thing they asked for. A refusal must leave no transaction behind.
 *
 * The other two are the screen's own rows moved away from what was opened: the link needs the payment tagged to
 * the item's event, and an item is bought with spending, never with income, a transfer or a trade. The words say
 * what to put back rather than what went wrong.
 */
export function buyRefusal(draft: Pick<FormDraft, 'mode' | 'amount' | 'eventId'>, eventId: string): string | null {
  if (draft.mode !== 'expense') return 'Buying an item is recorded as an expense.';
  if (draft.eventId !== eventId) return 'Buying an item records the payment under the item’s own event.';
  if (isRefund(draft)) {
    return 'What it cost is a figure above nought. Money coming back is recorded on its own, without buying an item.';
  }
  return null;
}
