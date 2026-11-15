import { DEFAULT_SPENDING_GUIDE } from '@expanses/core';
import { essentialSplitIn, getSpendingGuide, ownerScope, resolvedCategoryNeeds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useOpenBook } from '../workspaces/queries';

/** The open workspace's guide; 50 / 30 / 20 until it is read or when none was saved. */
export function useSpendingGuide() {
  const { database, ws } = useApp();
  const query = useQuery({ queryKey: ['spending-guide', ws.workspaceId, ws.bookId ?? null], queryFn: () => getSpendingGuide(database, ws) });
  return query.data ?? DEFAULT_SPENDING_GUIDE;
}

/**
 * Essential · Lifestyle · Debts & savings over a period, read as Cashflow reads its rings: events held out unless the
 * open workspace counts them. `owner` reads every workspace, as Financial health does.
 */
export function useEssentialSplit(range: { from: string; to: string }, opts: { paidAccountId?: string; owner?: boolean; enabled?: boolean } = {}) {
  const { database, ws } = useApp();
  const excludeEvents = !(useOpenBook()?.countEventsInBudget ?? false);
  const read = opts.owner ? ownerScope(ws) : ws;
  return useQuery({
    queryKey: ['essential-split', read.workspaceId, read.bookId ?? null, range.from, range.to, excludeEvents, opts.paidAccountId ?? null],
    enabled: opts.enabled ?? true,
    queryFn: () => essentialSplitIn(database, read, range.from, range.to, { excludeEvents, paidAccountId: opts.paidAccountId }),
  });
}

/** Every spending category's resolved mark: its own, an ancestor's, or essential. */
export function useResolvedNeeds(enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['resolved-needs', ws.workspaceId], enabled, queryFn: () => resolvedCategoryNeeds(database.db, ws) });
}

/** The spending categories that count under one mark, for the list's filter. Null until read. */
export function useNeedCategoryIds(need: 'essential' | 'lifestyle' | undefined): ReadonlySet<string> | null {
  const query = useResolvedNeeds(need !== undefined);
  if (!need || !query.data) return null;
  return new Set(Object.entries(query.data).filter(([, each]) => each === need).map(([id]) => id));
}
