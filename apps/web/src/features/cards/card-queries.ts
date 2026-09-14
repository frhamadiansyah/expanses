import { CATALOG } from '@expanses/catalog';
import { listCardIdentities, listCards, listIssuers } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useCards(accountId?: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['cards', ws.workspaceId, accountId ?? 'all'], queryFn: () => listCards(database, ws, accountId) });
}

/** Issuer and product name keyed by account, for every surface that shows a card. */
export function useCardIdentities() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['card-identities', ws.workspaceId],
    queryFn: async () => Object.fromEntries((await listCardIdentities(database, ws)).map((row) => [row.accountId, row])),
  });
}

export function useWorkspaceIssuers() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['issuers', ws.workspaceId], queryFn: () => listIssuers(database, ws) });
}

/**
 * Banks to choose from: the ones the catalogue knows, plus any already used here.
 *
 * Taken from data rather than a written-in list, so it is whatever the catalogue covers — an
 * Indonesian set today because that is what the entries are, a different one when they are.
 */
export function issuerChoices(workspaceIssuers: readonly string[]): string[] {
  return [...new Set([...CATALOG.map((entry) => entry.bank), ...workspaceIssuers])].sort((a, b) => a.localeCompare(b));
}

/** A stable colour per issuer, so a card is recognisable before you read it. */
export function issuerColour(issuer: string | null): string {
  if (!issuer) return 'hsl(215 16% 47%)';
  let hash = 0;
  for (const char of issuer) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 42% 38%)`;
}
