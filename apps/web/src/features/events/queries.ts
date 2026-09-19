import { booksInEvent, eventPlanFor, inBook, listEvents, listTransactions, ownerScope, suggestForEvent, type WorkspaceContext } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

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

/** What the event meant to buy, against what it actually bought. */
export function useEventPlan(eventId: string | null, bookId: string | null = null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-plan', ws.workspaceId, eventId, bookId],
    queryFn: () => eventPlanFor(database, scopeOf(ws, bookId), eventId!),
    enabled: eventId !== null,
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
