import { eventSheetFor, listEventBudgets, listEvents, listTransactions, ownerScope, suggestForEvent } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

// An event spans books (a trip touches Personal and Business alike), so every read here is owner-level.
export function useEvents() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['events', ws.workspaceId], queryFn: () => listEvents(database, ownerScope(ws)) });
}

export function useEventBudgets(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-budgets', ws.workspaceId, eventId],
    queryFn: () => listEventBudgets(database, ownerScope(ws), eventId!),
    enabled: eventId !== null,
  });
}

/** What the event was expected to cost, against what it did. */
export function useEventSheet(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-sheet', ws.workspaceId, eventId],
    queryFn: () => eventSheetFor(database, ownerScope(ws), eventId!),
    enabled: eventId !== null,
  });
}

/** Payments inside the window, in a category the event draws on, not yet tagged to anything. */
export function useEventSuggestions(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-suggestions', ws.workspaceId, eventId],
    queryFn: () => suggestForEvent(database, ownerScope(ws), eventId!),
    enabled: eventId !== null,
  });
}

/** What was tagged to the event, newest first: its own transaction history. */
export function useEventHistory(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-history', ws.workspaceId, eventId],
    queryFn: () => listTransactions(database, ownerScope(ws), { eventId: eventId! }),
    enabled: eventId !== null,
  });
}
