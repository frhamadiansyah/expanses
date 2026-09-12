import { monthRange } from '@expanses/core';
import { categoryTotalsBetween, listBudgets } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useCategorySpending(month: string) {
  const { database, ws } = useApp();
  const { from, to } = monthRange(month);
  return useQuery({
    queryKey: ['category-totals', ws.workspaceId, 'expense', month],
    queryFn: () => categoryTotalsBetween(database, ws, 'expense', from, to),
  });
}

export function useBudgets(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budgets', ws.workspaceId, month], queryFn: () => listBudgets(database, ws, month) });
}
