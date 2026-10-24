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
