import { isoDate } from '@expanses/core';
import {
  goalHistory,
  goalLinksFor,
  goalPlansFor,
  goalWholeness,
  isSetAsideHolder,
  listEarmarks,
  listGoalCalculators,
  listDraws,
  listGoals,
  setAsideChoiceOf,
  setAsideView,
  setAsideViews,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts } from '../../lib/queries';
import { useAssetProfiles } from '../networth/queries';

export function useGoals() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goals', ws.workspaceId], queryFn: () => listGoals(database, ws) });
}

export function useGoalPlans(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['goal-plans', ws.workspaceId, onDate], queryFn: () => goalPlansFor(database, ws, onDate) });
}

export function useGoalLinks(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['goal-links', ws.workspaceId, onDate], queryFn: () => goalLinksFor(database, ws, onDate) });
}

export function useEarmarks() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goal-earmarks', ws.workspaceId], queryFn: () => listEarmarks(database, ws) });
}

export function useGoalCalculators() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goal-calculators', ws.workspaceId], queryFn: () => listGoalCalculators(database, ws) });
}

/** One account's promises, shared out — an edit passes itself so it asks about the account as if it were not there. */
export function useSetAsideView(accountId: string | null, excludeTransactionId: string | null = null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['set-aside-view', ws.workspaceId, accountId, excludeTransactionId],
    queryFn: () => setAsideView(database, ws, accountId!, { date: isoDate(), excludeTransactionId }),
    enabled: !!accountId,
  });
}

export function useSetAsideViews() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['set-aside-views', ws.workspaceId], queryFn: () => setAsideViews(database, ws, { date: isoDate() }) });
}

export function useSetAsideChoiceOf(transactionId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['set-aside-choice', ws.workspaceId, transactionId],
    queryFn: () => setAsideChoiceOf(database, ws, transactionId!),
    enabled: !!transactionId,
  });
}

export function useGoalWholeness() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goal-wholeness', ws.workspaceId], queryFn: () => goalWholeness(database, ws, isoDate()) });
}

/** Every goal's whole history: the card shows the newest six and reads its funded window from all of it (`cardHistory`). */
export function useGoalHistory() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goal-history', ws.workspaceId], queryFn: () => goalHistory(database, ws, isoDate(), { limit: null }) });
}

/** Every recorded draw on a goal — the goal card reads which borrows were taken from a whole goal. */
export function useDraws() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['goal-draws', ws.workspaceId], queryFn: () => listDraws(database, ws, isoDate()) });
}

/** The server's own rule (`isSetAsideHolder`), asked synchronously so the form knows whether to offer a move. */
export function useCanHold(): (accountId: string) => boolean {
  const accounts = useAccounts().data ?? [];
  const profiles = useAssetProfiles().data ?? [];
  return (accountId) => {
    const account = accounts.find((row) => row.id === accountId);
    return !!account && isMoneyAccount(account) && isSetAsideHolder(account.subtype, profiles.find((row) => row.accountId === accountId)?.planGroup ?? null);
  };
}
