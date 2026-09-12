import { isoDate } from '@expanses/core';
import { debtHistory, listDebtProfiles, peopleDebts } from '@expanses/db';
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

export function useDebtHistory(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['debt-history', ws.workspaceId, accountId], queryFn: () => debtHistory(database, ws, accountId) });
}
