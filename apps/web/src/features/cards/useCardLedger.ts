import type { Balance, Cycle } from '@expanses/core';
import { type Database, deriveCycleEntries, programBalance, type WorkspaceContext } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/**
 * Fills the ledger for the cycles this page shows, then reads the balance.
 *
 * Deriving is a write, so it is asked for here rather than hidden inside loadCardPoints: a card page
 * that is opened brings its own cycles up to date, and nothing else recomputes behind the owner's back.
 */
export async function refreshLedger(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  cycles: (Cycle | null)[],
  today: string,
): Promise<Balance> {
  for (const cycle of cycles) {
    if (cycle) await deriveCycleEntries(database, ws, programId, cycle);
  }
  return programBalance(database, ws, programId, today);
}

export function useCardLedger(programId: string | undefined, cycles: (Cycle | null)[], today: string) {
  const { database, ws } = useApp();
  const key = cycles.map((cycle) => cycle?.start ?? '-').join(',');
  return useQuery({
    queryKey: ['card-ledger', ws.workspaceId, programId, key, today],
    enabled: !!programId,
    queryFn: () => refreshLedger(database, ws, programId!, cycles, today),
  });
}
