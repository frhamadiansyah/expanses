import { CATALOG } from '@expanses/catalog';
import { listCardIdentities, listCards, listIssuers, listPrograms } from '@expanses/db';
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

/**
 * Accounts that carry a reward program, so the Cards page can show a debit card.
 *
 * A credit card belongs there whether or not it earns anything; a bank account only belongs there
 * once a card's terms have been applied to it, or every savings account would turn up as a card.
 */
export function useProgramAccounts() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['program-accounts', ws.workspaceId],
    queryFn: async () => new Set((await listPrograms(database, ws)).filter((p) => p.archivedAt === null).map((p) => p.cardAccountId)),
  });
}
