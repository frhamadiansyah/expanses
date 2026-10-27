import { activityLine, type ActivityGroup, activityOf, type ActivityKind, undoActivity } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';

/** The list, newest first. `limit` asks for one more than is shown, so the page knows whether there is more. */
export function useActivity(kind: ActivityKind | ActivityGroup | 'all', limit: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['activity', ws.workspaceId, kind, limit], queryFn: () => activityOf(database, ws, { kind, limit }) });
}

/** One line, for its page. */
export function useActivityLine(id: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['activity-line', ws.workspaceId, id], queryFn: () => activityLine(database, ws, id) });
}

/** Undo, with the ledger's refusal handed to the page's ErrorBox as it is. Returns whether it went through. */
export function useUndoActivity(onError: (error: unknown) => void) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy(true);
      onError(null);
      try {
        await undoActivity(database, ws, id);
        await invalidate();
        return true;
      } catch (failure) {
        onError(failure);
        // A refusal can mean the line moved on (changed again): show it as it stands now.
        await invalidate();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [database, ws, invalidate, onError],
  );
  return { busy, run };
}
