import {
  booksInEvent,
  type Database,
  eventItemsExist,
  eventPlanFor,
  inBook,
  listEventCurrencies,
  listEventItems,
  listEvents,
  listTransactions,
  ownerScope,
  purchaseCover,
  storedConverter,
  suggestForEvent,
  type WorkspaceContext,
} from '@expanses/db';
import { isoDate } from '@expanses/core';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useResolveRates } from '../../lib/queries';

// An event spans books (a trip touches Personal and Business alike), so every read here is owner-level.
export function useEvents() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['events', ws.workspaceId], queryFn: () => listEvents(database, ownerScope(ws)) });
}

/**
 * The scope one tab on the event screen reads in: the whole trip, or the one workspace chosen.
 *
 * The open workspace has nothing to do with it — an event is read from wherever you happen to be — so the
 * default is always owner-wide, and a tab narrows it by name rather than by what the app has open.
 */
const scopeOf = (ws: WorkspaceContext, bookId: string | null) => (bookId ? inBook(ws, bookId) : ownerScope(ws));

/** The workspaces that have spending tagged to this event — one tab each, above the ring. */
export function useBooksInEvent(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-books', ws.workspaceId, eventId],
    queryFn: () => booksInEvent(database, ownerScope(ws), eventId!),
    enabled: eventId !== null,
  });
}

/*
 * Rates for the currencies a plan is read in. An item priced in another currency than the event's is shown at the day's
 * rate, so the rate of each foreign currency is fetched (or found stored, or reported missing) before the plan is read.
 * Asked once a session per day and set of currencies: a failed fetch is tried again on the next open, a stored rate never
 * asks. What is read afterwards is only what is stored, so a missing rate shows as missing rather than as a guess.
 */
const asked = new Set<string>();

async function ensureRates(
  currencies: readonly string[],
  base: string,
  workspaceId: string,
  resolve: (currencies: string[], onDate: string) => Promise<{ missing: string[] }>,
): Promise<void> {
  const needed = [...new Set(currencies)].filter((code) => code !== base).sort();
  const key = `${workspaceId}|${isoDate()}|${needed.join()}`;
  if (needed.length === 0 || asked.has(key)) return;
  asked.add(key);
  try {
    if ((await resolve(needed, isoDate())).missing.length > 0) asked.delete(key);
  } catch {
    asked.delete(key);
  }
}

/** Every currency the event's plan is read in: its own, and each item's. */
async function currenciesOfPlan(database: Database, ws: WorkspaceContext, eventId: string): Promise<string[]> {
  const own = (await listEventCurrencies(database.db, ws)).get(eventId);
  const items = await listEventItems(database, ws, eventId);
  return [...(own ? [own] : []), ...items.flatMap((item) => (item.currency ? [item.currency] : []))];
}

/** What the event meant to buy, against what it actually bought. */
export function useEventPlan(eventId: string | null, bookId: string | null = null) {
  const { database, ws } = useApp();
  const resolve = useResolveRates();
  return useQuery({
    queryKey: ['event-plan', ws.workspaceId, eventId, bookId],
    queryFn: async () => {
      await ensureRates(await currenciesOfPlan(database, ws, eventId!), ws.baseCurrency, ws.workspaceId, resolve);
      return eventPlanFor(database, scopeOf(ws, bookId), eventId!);
    },
    enabled: eventId !== null,
  });
}

/**
 * The stored rates as a converter, once the given currencies' rates were asked for. For the item form's estimate, which
 * is read before anything is saved and so cannot come from the plan.
 */
export function usePlanConverter(currencies: readonly string[]) {
  const { database, ws } = useApp();
  const resolve = useResolveRates();
  const wanted = [...new Set(currencies)].sort();
  return useQuery({
    queryKey: ['plan-converter', ws.workspaceId, wanted.join(), isoDate()],
    queryFn: async () => {
      await ensureRates(wanted, ws.baseCurrency, ws.workspaceId, resolve);
      return storedConverter(database.db, ws.baseCurrency);
    },
  });
}

/**
 * Whether this copy of the data has the table a plan's items live in.
 *
 * A database stopped before migration 0049 has no `event_items`, and every write to it is a deliberate no-op that
 * still hands back an id — correct for the repository, and a trap for a screen, which would show a saved item
 * disappear with nothing said. So the screens ask first and say so plainly, instead of letting a save look like it
 * worked. Not memoised past a refresh: `migrate()` may run on the same handle, and the answer then changes.
 */
export function useEventItemsReady() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['event-items-ready', ws.workspaceId], queryFn: () => eventItemsExist(database.db) });
}

/**
 * One receipt, what it already answers, and what is left on it.
 *
 * Owner-level whatever tab is open: a receipt is one payment, and how much of it is still unaccounted for is a fact
 * about that payment rather than about the workspace it is being read from. Narrowing it would let two tabs disagree
 * about how much of one receipt is left, and the write that checks the shares does not narrow either.
 */
export function usePurchaseCover(transactionId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['purchase-cover', ws.workspaceId, transactionId],
    queryFn: () => purchaseCover(database, ownerScope(ws), transactionId!),
    enabled: transactionId !== null,
  });
}

/**
 * Payments inside the window, in a category the event draws on, not yet tagged to anything.
 *
 * Narrowed by the tab like everything else: under one workspace the categories the event draws on are that
 * workspace's, so what is offered there is what tagging it would actually add to the ring being read.
 */
export function useEventSuggestions(eventId: string | null, bookId: string | null = null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-suggestions', ws.workspaceId, eventId, bookId],
    queryFn: () => suggestForEvent(database, scopeOf(ws, bookId), eventId!),
    enabled: eventId !== null,
  });
}

/**
 * What was tagged to the event, newest first: its own transaction history.
 *
 * The tab narrows the rows, never the money they are read in: the list is asked for owner-wide and the book is
 * passed as a filter, so the figures stay in the owner's currency — which is what the page's labels say, and what
 * the ring above them is already adding up.
 */
export function useEventHistory(eventId: string | null, bookId: string | null = null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-history', ws.workspaceId, eventId, bookId],
    queryFn: () => listTransactions(database, ownerScope(ws), { eventId: eventId!, ...(bookId ? { bookId } : {}) }),
    enabled: eventId !== null,
  });
}
