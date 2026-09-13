import type { Balance, Cycle } from '@expanses/core';
import type { CardYearRoi } from '@expanses/db';
import { cardYearRoi, type Database, deriveCycleEntries, expireDueEntries, programBalance, type WorkspaceContext } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export interface CardLedger {
  balance: Balance;
  roi: CardYearRoi;
}

/**
 * Fills the ledger for the cycles this page shows, then reads the balance and the year's worth.
 *
 * Deriving is a write, so it is asked for here rather than hidden inside loadCardPoints: a card page
 * that is opened brings its own cycles up to date, and nothing else recomputes behind the owner's back.
 *
 * Both figures are read in this one query, after the writes. Asking for them separately let the ROI
 * read an empty ledger and report a year worth nothing until the page was opened a second time.
 */
export async function refreshLedger(
  database: Database,
  ws: WorkspaceContext,
  programId: string,
  cycles: (Cycle | null)[],
  today: string,
): Promise<CardLedger> {
  for (const cycle of cycles) {
    if (cycle) await deriveCycleEntries(database, ws, programId, cycle);
  }
  // Points the issuer has already taken back are written off here, rather than left on a balance that
  // would then be wrong. The entry stays visible, so nothing disappears without a record.
  await expireDueEntries(database, ws, programId, today);
  return {
    balance: await programBalance(database, ws, programId, today),
    roi: await cardYearRoi(database, ws, programId, today),
  };
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
