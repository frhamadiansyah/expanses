// The Add screen's address, read on its own so the reading can be tested without building the whole router.

/**
 * A new transaction opened from somewhere that already knows part of it: an account's own page, whose Spend,
 * Receive and Transfer open the form in that mode with the account filled in. `account` is the Paid with, Received
 * into or From; `to` a transfer's To. An event's Add spending names the `event`, and its plan's "Buy it now" the
 * `item` too, with `ws` the workspace tab the plan was read in (handed back on the way out, as the plan screens hand
 * it to each other — never where the payment is filed). Nothing given, the form opens as the tab bar's ＋ opens it.
 */
export interface NewTransactionSearch {
  mode?: 'expense' | 'income' | 'transfer';
  account?: string;
  to?: string;
  event?: string;
  item?: string;
  ws?: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

export const newTransactionSearch = (search: Record<string, unknown>): NewTransactionSearch => ({
  ...(search.mode === 'expense' || search.mode === 'income' || search.mode === 'transfer' ? { mode: search.mode } : {}),
  ...(text(search.account) ? { account: text(search.account) } : {}),
  ...(text(search.to) ? { to: text(search.to) } : {}),
  ...(text(search.event) ? { event: text(search.event) } : {}),
  // An item is bought inside its event, so one carried without an event is dropped here rather than half-read later.
  ...(text(search.event) && text(search.item) ? { item: text(search.item) } : {}),
  ...(text(search.ws) ? { ws: text(search.ws) } : {}),
});
