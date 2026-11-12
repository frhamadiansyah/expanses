// The Add screen's address, read on its own so the reading can be tested without building the whole router.

/**
 * A new transaction opened from somewhere that already knows part of it: an account's own page, whose Spend,
 * Receive and Transfer open the form in that mode with the account filled in. `account` is the Paid with, Received
 * into or From; `to` a transfer's To. An event's Add spending names the `event`, and its plan's "Buy it now" the
 * `item` too, with `ws` the workspace tab the plan was read in (handed back on the way out, as the plan screens hand
 * it to each other — never where the payment is filed). Nothing given, the form opens as the tab bar's ＋ opens it.
 */
export interface NewTransactionSearch {
  /** `trade` is Net worth's Trade corner: the trade rows under their own Buy and Sell tabs, not the Add form's three. */
  mode?: 'expense' | 'income' | 'transfer' | 'trade';
  account?: string;
  to?: string;
  event?: string;
  item?: string;
  /** A shared event's expense, opened for editing on the Add screen (shared events §6). Read only with `event`. */
  expense?: string;
  ws?: string;
  /**
   * A partner's joint account or joint card, by its item id, opened from its card in Wallet: Paid with is that item —
   * or, in a transfer, From is — once the group's workspace lists it (`paidWithItems`).
   */
  partner?: string;
  /**
   * What was already typed on the workspace card when a shared event was picked on its Event row (shared events §6):
   * the amount, its currency, the note and the date, carried into the shared card. Read only with a bare `event`.
   */
  amount?: string;
  currency?: string;
  note?: string;
  date?: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

const carried = (search: Record<string, unknown>): Partial<NewTransactionSearch> => ({
  ...(text(search.amount) ? { amount: text(search.amount) } : {}),
  ...(text(search.currency) ? { currency: text(search.currency) } : {}),
  ...(text(search.note) ? { note: text(search.note) } : {}),
  ...(text(search.date) ? { date: text(search.date) } : {}),
});

export const newTransactionSearch = (search: Record<string, unknown>): NewTransactionSearch => ({
  ...(search.mode === 'expense' || search.mode === 'income' || search.mode === 'transfer' || search.mode === 'trade' ? { mode: search.mode } : {}),
  ...(text(search.account) ? { account: text(search.account) } : {}),
  ...(text(search.to) ? { to: text(search.to) } : {}),
  ...(text(search.event) ? { event: text(search.event) } : {}),
  // An item is bought inside its event, so one carried without an event is dropped here rather than half-read later.
  ...(text(search.event) && text(search.item) ? { item: text(search.item) } : {}),
  ...(text(search.event) && text(search.expense) ? { expense: text(search.expense) } : {}),
  ...(text(search.ws) ? { ws: text(search.ws) } : {}),
  // A partner's item pays a purchase of the workspace's own, never an event's: an event drops it.
  ...(text(search.partner) && !text(search.event) ? { partner: text(search.partner) } : {}),
  ...(text(search.event) && !text(search.item) && !text(search.expense) ? carried(search) : {}),
});
