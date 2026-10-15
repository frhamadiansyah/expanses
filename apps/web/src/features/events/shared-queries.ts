import { isoDate } from '@expanses/core';
import {
  convertEventToShared,
  type Database,
  eventBalanceRows,
  eventRatesWanted,
  listEventItems,
  listTransactions,
  moveIntoSharedEvent,
  ownerScope,
  type ResolvedRates,
  type SharedEventView,
  sharedEventPlan,
  sharedEventSummaries,
  sharedEventView,
  type WorkspaceContext,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import type { ConversionLeft, ConversionSteps } from './share-event';

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

/** The transactions a shared event's records put in this phone's books: moved purchases among them. */
function derivedIdsOf(view: SharedEventView | null): Set<string> {
  const ids = [...(view?.expenses ?? []).map((e) => e.posting?.transactionId), ...(view?.settlements ?? []).map((s) => s.posting?.transactionId)];
  return new Set(ids.filter((id): id is string => typeof id === 'string'));
}

/** `finishConversion`'s steps against this phone's db (I9). Owner-level, as sharing an event is. */
export function conversionSteps(database: Database, ws: WorkspaceContext, eventId: string): ConversionSteps {
  const owner = ownerScope(ws);
  return {
    sharedItemCount: async () => ((await sharedEventPlan(database, owner, eventId))?.lines ?? []).flatMap((line) => line.items).length,
    derivedIds: async () => derivedIdsOf(await sharedEventView(database, owner, eventId)),
    tagged: async () => (await listTransactions(database, owner, { eventId, limit: 5_000 })).map((t) => t.id),
    convert: async () => (await convertEventToShared(database, owner, eventId)).kept,
    move: async (transactionIds) => (await moveIntoSharedEvent(database, owner, eventId, transactionIds)).kept,
  };
}

/**
 * The rates a conversion needs, fetched before it runs: today's for the event currency (the plan is priced in it), and
 * each tagged purchase's own day for its currencies. A rate that cannot be had is left to the move, which keeps that
 * purchase where it is and says why.
 */
export async function fetchConversionRates(
  database: Database,
  ws: WorkspaceContext,
  eventId: string,
  currency: string,
  resolveRates: (currencies: string[], onDate: string) => Promise<ResolvedRates>,
): Promise<void> {
  const tagged = await listTransactions(database, ownerScope(ws), { eventId, limit: 5_000 });
  for (const day of new Set([isoDate(), ...tagged.map((t) => t.occurredOn)])) {
    const currencies = new Set([currency, ...tagged.filter((t) => t.occurredOn === day).flatMap((t) => [t.originalCurrency, ...t.entries.map((x) => x.currency)])]);
    await resolveRates([...currencies].filter((c): c is string => !!c && c !== ws.baseCurrency), day).catch(() => undefined);
  }
}

/** What sharing left behind for this event on this phone (I9), read only while the page can still act on it. */
export function useConversionLeft(eventId: string, setId: string | null, enabled: boolean) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['shared-event-left', ws.workspaceId, eventId, setId],
    enabled,
    queryFn: async (): Promise<ConversionLeft> => {
      const owner = ownerScope(ws);
      const view = await sharedEventView(database, owner, eventId);
      const derived = derivedIdsOf(view);
      const tagged = await listTransactions(database, owner, { eventId, limit: 5_000 });
      const local = await listEventItems(database, owner, eventId);
      const sharedItems = ((await sharedEventPlan(database, owner, eventId))?.lines ?? []).flatMap((line) => line.items).length;
      return {
        remaining: tagged.filter((t) => !derived.has(t.id)).length,
        localItems: local.length,
        sharedItems,
        setWithoutCategories: setId !== null && (view?.categories.length ?? 0) === 0,
      };
    },
  });
}
