import { isoDate } from '@expanses/core';
import { debtHistory, listDebtProfiles, peopleDebts, recentPeople } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function usePeopleDebts(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['people-debts', ws.workspaceId, onDate], queryFn: () => peopleDebts(database, ws, onDate) });
}

export function useDebtProfiles() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['debt-profiles', ws.workspaceId], queryFn: () => listDebtProfiles(database, ws) });
}

/**
 * Who to offer as a chip under With: people already on the books, most recently used first.
 *
 * `recentPeople` already answers exactly this question — the repository function was written for this sheet in
 * Task 5 and has been sitting unused since. A list built here out of `listDebtProfiles` would be a second answer
 * to the same question, ordered by whatever this file happened to sort by.
 */
export function useRecentPeople() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['recent-people', ws.workspaceId], queryFn: () => recentPeople(database, ws) });
}

export function useDebtHistory(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['debt-history', ws.workspaceId, accountId], queryFn: () => debtHistory(database, ws, accountId) });
}
