import { countPendingDrafts, type DraftRow, listDrafts } from '@expanses/db';
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
