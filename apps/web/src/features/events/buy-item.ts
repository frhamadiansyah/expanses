import { EventError } from '@expanses/db';

/**
 * Where "Buy it now" goes.
 *
 * Today that is the event's own Add spending card — the only path in the app that can fill in an event, since
 * TransactionForm has no event field and tagging is a second write. When the Add Transaction rebuild lands, this
 * function returns `{ to: '/transactions/new', search: { amount, category, event, planItem } }` instead and the new
 * form's save calls `linkEventItem` with the id it posted. One body, one call site: no screen of this feature moves.
 */
export function buyTarget(eventId: string, itemId: string) {
  return { to: '/events/$eventId' as const, params: { eventId }, search: { buy: itemId } };
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
