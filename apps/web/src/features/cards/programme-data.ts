import {
  type Database,
  getProgramme,
  getProgrammeValuePerPoint,
  listCards,
  listProgrammes,
  listProgrammeTiers,
  listRedemptionOptions,
  programBalance,
  programmeEarners,
  programmeHistory,
  type ProgrammeHistoryRow,
  programmePartners,
  refreshProgramme,
  type WorkspaceContext,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/**
 * Everything a points programme's own page reads — and the Mac Points page's peek, which shows the same programme — in
 * one load, so the two read the same figures. Opening it brings the ledger up to date first, as a card's page does:
 * each earning card works out its open cycle and the one before, and points past their date are written off. Null for
 * a programme that is not there.
 */
export async function loadProgramme(database: Database, ws: WorkspaceContext, programmeId: string, today: string) {
  if (!(await getProgramme(database, ws, programmeId))) return null;
  await refreshProgramme(database, ws, programmeId, today);
  return readProgramme(database, ws, programmeId, today);
}

/**
 * The same figures read as they stand, without bringing the ledger up to date: for the Mac peek, whose page has just
 * brought every programme up to date itself — a second refresh running beside the page's would write the same
 * cycles twice.
 */
export async function readProgramme(database: Database, ws: WorkspaceContext, programmeId: string, today: string) {
  const programme = await getProgramme(database, ws, programmeId);
  if (!programme) return null;
  const earners = (await programmeEarners(database, ws)).get(programmeId) ?? [];
  const options = (await Promise.all(earners.map((earner) => listRedemptionOptions(database, ws, earner.programId)))).flat();
  return {
    programme,
    earners,
    options,
    valuePerPoint: await getProgrammeValuePerPoint(database, ws, programmeId),
    balance: await programBalance(database, ws, programmeId, today),
    history: await programmeHistory(database, ws, programmeId),
    partners: await programmePartners(database, ws, programmeId),
    others: (await listProgrammes(database, ws)).filter((other) => other.id !== programmeId),
    // Which of its membership cards Points draws it as (0088), for its Settings.
    tier: (await listProgrammeTiers(database, ws))[programmeId] ?? null,
    // The last digits of each earning card, for the grey line under it in Settings.
    digits: await cardDigits(database, ws),
  };
}

export type ProgrammeData = NonNullable<Awaited<ReturnType<typeof loadProgramme>>>;

/** One programme's page data on `today` (`loadProgramme`); `read` for the Mac peek's, as it stands (`readProgramme`). */
export function useProgramme(programmeId: string, today: string, read = false) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: [read ? 'programme-read' : 'programme', ws.workspaceId, programmeId, today],
    queryFn: () => (read ? readProgramme : loadProgramme)(database, ws, programmeId, today),
  });
}

/** A card's earning in the statement still open today: the earliest of its statements dated today or later. */
export function thisStatement(history: readonly ProgrammeHistoryRow[], programId: string, today: string): ProgrammeHistoryRow | undefined {
  return history
    .filter((row) => row.kind === 'earn' && row.earnedById === programId && row.on >= today)
    .sort((a, b) => a.on.localeCompare(b.on))[0];
}

/** What this statement's points come to across the cards earning here, for the Convert sheet's estimates. */
export function statementPointsOf(history: readonly ProgrammeHistoryRow[], earners: readonly { programId: string }[], today: string): number {
  return earners.reduce((sum, earner) => sum + (thisStatement(history, earner.programId, today)?.quantity ?? 0), 0);
}

/** The last four digits of each card account's first card that has them, by account. */
async function cardDigits(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const card of await listCards(database, ws)) if (card.last4 && !out[card.accountId]) out[card.accountId] = card.last4;
  return out;
}
