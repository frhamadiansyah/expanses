import { countPendingDrafts, type DraftRow, guessCategoryFromHistory, listDrafts, listSkipped, listSources } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useDrafts(status: DraftRow['status'] = 'pending') {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['drafts', ws.workspaceId, status], queryFn: () => listDrafts(database, ws, status) });
}

/** How many captures are waiting, for the badge that says there is anything to do. */
export function usePendingDraftCount() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['drafts-pending-count', ws.workspaceId], queryFn: () => countPendingDrafts(database, ws) });
}

/** What was skipped in the last week, for the foot of the queue. */
export function useSkippedCaptures() {
  const { database, ws } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  return useQuery({ queryKey: ['captures-skipped', ws.workspaceId], queryFn: () => listSkipped(database, ws, today) });
}

/** Every source this phone knows, for the queue's rows and Settings → Capture. */
export function useCaptureSources() {
  const { database } = useApp();
  return useQuery({ queryKey: ['capture-sources'], queryFn: () => listSources(database) });
}

/**
 * The category the Add form would open each uncategorised expense or income draft on (the merchant's history), by
 * draft id, so the queue's rows and swipe agree with the sheet. Drafts that already have a category, and transfers,
 * are not asked about.
 */
export function useDraftCategoryGuesses(drafts: readonly DraftRow[]) {
  const { database, ws } = useApp();
  const asked = drafts.filter((d) => (d.kind === 'expense' || d.kind === 'income') && !d.categoryAccountId);
  const signature = asked.map((d) => `${d.id}:${d.kind}:${d.description}`).join('|');
  return useQuery({
    queryKey: ['drafts-guesses', ws.workspaceId, signature],
    queryFn: async () => {
      const found = await Promise.all(
        asked.map(async (d) => [d.id, await guessCategoryFromHistory(database, ws, d.description, d.kind as 'expense' | 'income')] as const),
      );
      return Object.fromEntries(found) as Record<string, string | null>;
    },
    enabled: asked.length > 0,
  });
}
