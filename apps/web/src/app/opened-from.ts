/*
 * Where each of Wallet's pages was opened from: a card (`/cards/<id>`), an account (`/accounts/<id>`), a partner's
 * joint item (`/wallet/joint/<id>`). Its ✕ goes back there in one step however many of the item's own pages were walked
 * in between — the statement and its ‹, a receipt opened from a statement line, the Pay screen — because what is
 * remembered is the place in the history the item was entered from, not the step behind the page now on screen.
 *
 * Owner, 25 Nov 2026: ✕ on a card used to go one step back whenever the stack's place had been let go (a receipt, the
 * Pay screen, a card opened from the Debts list, a statement opened by its address), and one step back from the card
 * the statement's ‹ had opened was the statement again: ‹ and ✕ took turns, and the card could not be left.
 */

/** The history's own index of a location, as the router writes it. */
type Located = { pathname: string; state: unknown };
const indexOf = (location: Located): number => (location.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0;

/** Static pages that sit where an item's id would: none of them is an item. */
const NOT_ITEMS = new Set(['merchants', 'points', 'new', 'add', 'reorder']);

/**
 * The item a location belongs to: the id after `/cards/`, `/accounts/` or `/wallet/joint/`, for the item's page and
 * every page under it (a card's statement, its settings), or null for anywhere else.
 */
export function itemOf(pathname: string): string | null {
  const match = /^\/(?:cards|accounts|wallet\/joint)\/([^/]+)/.exec(pathname);
  const id = match?.[1];
  return id && !NOT_ITEMS.has(id) ? decodeURIComponent(id) : null;
}

/** Whether a location is one of the item's own: its id is one of the path's segments (`/net-worth/assets/<id>/settings` too). */
function isItems(pathname: string, item: string): boolean {
  return pathname.split('/').some((segment) => decodeURIComponent(segment) === item);
}

/** For each item, the index of the history entry it was opened from; -1 when nothing in this history opened it. */
const openers = new Map<string, number>();

/**
 * Notes one location as the router resolves it, after `from` (the one before, if any).
 *
 * An item is entered when a location of its own is reached by a step forward or in place (a link, a replace, the first
 * load) from a location that is not one of its own: the entry behind it is the opener. A step back onto it keeps what
 * was noted when it was entered, and so does every move between its own pages.
 */
export function noteLocation(to: Located, from: Located | null): void {
  const item = itemOf(to.pathname);
  if (item === null) return;
  const at = indexOf(to);
  if (from && indexOf(from) > at) return;
  if (from && isItems(from.pathname, item)) {
    // Its own page replaced or followed by another of its own: still the same visit, unless none was ever noted.
    if (!openers.has(item)) openers.set(item, at - 1);
    return;
  }
  openers.set(item, at - 1);
}

/**
 * How many steps back the item's opener is from `now`, the index on screen: a negative number for `history.go`, or
 * null when nothing in this history opened it (a deep link, the app's first page), when ✕ goes to Wallet instead.
 */
export function stepsToOpener(item: string, now: number): number | null {
  const at = openers.get(item);
  return at === undefined || at < 0 || at >= now ? null : at - now;
}

/** Called once with the router: notes every location it resolves. */
export function trackOpeners(router: {
  subscribe: (event: 'onResolved', fn: () => void) => unknown;
  state: { location: Located };
}): void {
  let last: Located | null = null;
  const note = () => {
    const { pathname, state } = router.state.location;
    const to = { pathname, state };
    noteLocation(to, last);
    last = to;
  };
  note();
  router.subscribe('onResolved', note);
}

/** Forgets every opener: for tests. */
export function resetOpeners(): void {
  openers.clear();
}
