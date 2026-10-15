import { eventBalanceRows, eventRatesWanted, ownerScope, sharedEventPlan, sharedEventSummaries, sharedEventView } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';

/*
 * A shared event's reads (shared events §6). Owner-level, as every event read is: an event belongs to no workspace tab.
 * Every write ends in `useInvalidateAll`, which also nudges the sync, so these re-read after a record goes out or comes in.
 */

export function useSharedEventView(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event', ws.workspaceId, eventId], queryFn: () => sharedEventView(database, ownerScope(ws), eventId!), enabled: eventId !== null });
}

export function useSharedEventSummaries() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event-summaries', ws.workspaceId], queryFn: () => sharedEventSummaries(database, ownerScope(ws)) });
}

export function useSharedEventPlan(eventId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['shared-event-plan', ws.workspaceId, eventId], queryFn: () => sharedEventPlan(database, ownerScope(ws), eventId!), enabled: eventId !== null });
}

export function useEventBalanceRows() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['event-balance-rows', ws.workspaceId], queryFn: () => eventBalanceRows(database, ownerScope(ws)) });
}

/**
 * Fetches the rates this phone's records wait for (§5): each pair once, while the page is open. Saving a rate posts
 * what waited for it (`upsertRate` retries), so the page only has to read again.
 */
export function useFetchEventRates(active: boolean): void {
  const { database } = useApp();
  const resolveRates = useResolveRates();
  const invalidate = useInvalidateAll();
  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const wanted = await eventRatesWanted(database);
      for (const { currency, onDate } of wanted) await resolveRates([currency], onDate).catch(() => undefined);
      if (live && wanted.length > 0) await invalidate();
    })();
    return () => {
      live = false;
    };
  }, [active, database, resolveRates, invalidate]);
}
