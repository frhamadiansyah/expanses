import { addMonths } from '@expanses/core';
import { budgetSheetFor, committedByCategory, listBudgets } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { historyOf } from './budget-view';

export function useBudgetSheet(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month], queryFn: () => budgetSheetFor(database, ws, month) });
}

/** The plan rows themselves, so the sheet can mark which caps this month overrode. */
export function useBudgets(month: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budgets', ws.workspaceId, ws.bookId ?? null, month], queryFn: () => listBudgets(database, ws, month) });
}

/**
 * What each category already owes to recurring bills, so a budget can say what is spoken for.
 *
 * Only the figures: a bill no rate reached is named by the sheet's own `unconverted`, so the page says it once.
 */
export function useCommittedBills() {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['bills-committed', ws.workspaceId, ws.bookId ?? null],
    queryFn: async () => (await committedByCategory(database, ws)).committed,
  });
}

/**
 * What each category spent in the three months before `month`, read from those months' own sheets — the same
 * queries the page reads a month with, so a figure here is what a cap there would have measured. Null until all three
 * are read.
 */
export function useSpendingHistory(month: string, currency: string) {
  const { database, ws } = useApp();
  const months = [1, 2, 3].map((back) => addMonths(month, -back));
  const sheets = useQueries({
    queries: months.map((each) => ({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, each], queryFn: () => budgetSheetFor(database, ws, each) })),
  });
  if (!sheets.every((sheet) => sheet.data)) return null;
  return historyOf(
    sheets.map((sheet) => sheet.data!.lines),
    currency,
  );
}
