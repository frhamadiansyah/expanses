import { budgetSheetFor, listBudgets } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useBudgetSheet(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budget-sheet', ws.workspaceId, month], queryFn: () => budgetSheetFor(database, ws, month) });
}

/** The plan rows themselves, so the sheet can mark which caps this month overrode. */
export function useBudgets(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budgets', ws.workspaceId, month], queryFn: () => listBudgets(database, ws, month) });
}
