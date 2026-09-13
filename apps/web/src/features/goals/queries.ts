import { isoDate } from '@expanses/core';
import { goalLinksFor, goalPlansFor, listEarmarks, listGoalCalculators, listGoals } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

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
