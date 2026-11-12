import { markReturn } from '../lib/page-memory';
import { useSearch } from '@tanstack/react-router';

/**
 * Where a section page was opened from, when that is not its own place in the More sheet.
 *
 * Review and Recurring are sections — opened from the More sheet they have no way back, as every section has none.
 * Cashflow opens them as well, from its "not recorded" and "recurring" rows, and from there they are a step down from
 * Cashflow: `?from=cashflow` says so, and the page draws a pushed screen's title, its ‹ going back to Cashflow. A
 * bill opened from Recurring carries it on, so Bill → Recurring → Cashflow still finds its way back.
 */
export interface FromSearch {
  from?: 'cashflow';
}

/** The routes' `validateSearch`: only a known origin is kept; anything else reads as a section opened on its own. */
export function fromSearch(search: Record<string, unknown>): FromSearch {
  return search.from === 'cashflow' ? { from: 'cashflow' } : {};
}

/**
 * A bill's page knows one origin more: a transaction's receipt (or the receipt's bill list) that opened it. Its ‹ then
 * goes back to that receipt, and the bill is the receipt's own step — never remembered as where a Save or a Delete on
 * the receipt lands (`trackOrigin`). It is never passed on: the pages a bill opens keep `useFrom`, Cashflow alone.
 */
export interface BillFromSearch {
  from?: 'cashflow' | 'transaction';
}

/** The search a receipt opens its bill with. */
export const FROM_TRANSACTION = { from: 'transaction' } as const;

/** A bill route's origin: a transaction, or what `fromSearch` keeps. */
export function billFromSearch(search: Record<string, unknown>): BillFromSearch {
  return search.from === 'transaction' ? { ...FROM_TRANSACTION } : fromSearch(search);
}

/** Whether this page was opened from a transaction's receipt (`FROM_TRANSACTION`). */
export function useFromTransaction(): boolean {
  const search = useSearch({ strict: false }) as BillFromSearch;
  return search.from === 'transaction';
}

/** A page opened as a transaction's own step: its receipt's bill, opened with `FROM_TRANSACTION`. */
function openedFromTransaction(href: string): boolean {
  const query = href.indexOf('?');
  if (query < 0) return false;
  const from = new URLSearchParams(href.slice(query + 1).split('#')[0]).get('from');
  // The router may write a string search value bare or JSON-quoted.
  return from === 'transaction' || from === '"transaction"';
}

/** The origin this page was opened with, to pass on to the next one. */
export function useFrom(): FromSearch {
  const search = useSearch({ strict: false }) as FromSearch;
  return search.from === 'cashflow' ? { from: 'cashflow' } : {};
}

/**
 * The way back a section page draws when Cashflow opened it — a pushed screen's ‹ circle (`PushedTitle`), named
 * for a screen reader — or null when it was opened as a section, with its large title and no way back.
 */
export function useBackToCashflow(): { back: string; backTo: '/transactions' } | null {
  return useFrom().from === 'cashflow' ? { back: 'Cashflow', backTo: '/transactions' } : null;
}

/*
 * The page a receipt, its Edit or its Duplicate was opened from.
 *
 * Rows open the receipt from everywhere — Cashflow, an event, a card's statement, a goal, a bill's history, the
 * wallet, a search — and Edit and Delete used to land on Cashflow whichever it was. The last page that is not itself
 * one of those three is remembered as the router resolves each location, so every row inherits the way back without
 * each of them passing it on, and a Save or a Delete returns to the exact address (tab and all) it was opened at.
 * Nothing remembered (a reload, a deep link) falls back to Cashflow, as before.
 */
let origin: string | null = null;

/** A receipt (`/transactions/<id>`), its edit or its duplicate, and the Add screen, which no receipt is opened from; "flow" is a screen of its own. */
export function isTransactionDetail(pathname: string): boolean {
  return /^\/transactions\/(?!flow$)[^/]+(\/(edit|duplicate|bill(\/[^/]+)?))?\/?$/.test(pathname);
}

/** Called once with the router: remembers each location that is not a transaction's own screen, nor a step it opened. */
export function trackOrigin(router: {
  subscribe: (event: 'onResolved', fn: () => void) => unknown;
  state: { location: { pathname: string; href: string } };
}): void {
  const note = () => {
    const { pathname, href } = router.state.location;
    if (!isTransactionDetail(pathname) && !openedFromTransaction(href)) origin = href;
  };
  note();
  router.subscribe('onResolved', note);
}

/** Where a transaction's Save or Delete lands: the page its receipt was opened from, else Cashflow. */
export function originHref(): string {
  const href = origin ?? '/transactions';
  // Where the page lands is a new entry: let it find what it was showing when this one was left (filters, sort).
  markReturn(href);
  return href;
}
