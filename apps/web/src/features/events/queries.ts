import { eventSheetFor, listEventBudgets, listEvents, suggestForEvent } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useEvents() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['events', ws.workspaceId], queryFn: () => listEvents(database, ws) });
}

export function useEventBudgets(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-budgets', ws.workspaceId, eventId],
    queryFn: () => listEventBudgets(database, ws, eventId!),
    enabled: eventId !== null,
  });
}

/** What the event was expected to cost, against what it did. */
export function useEventSheet(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-sheet', ws.workspaceId, eventId],
    queryFn: () => eventSheetFor(database, ws, eventId!),
    enabled: eventId !== null,
  });
}

/** Payments inside the window, in a category the event draws on, not yet tagged to anything. */
export function useEventSuggestions(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['event-suggestions', ws.workspaceId, eventId],
    queryFn: () => suggestForEvent(database, ws, eventId!),
    enabled: eventId !== null,
  });
}
