import { addMonths, monthPeriod } from '@expanses/core';
import { budgetSheetFor, categoryItemsIn, committedByCategory, listBudgets } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useMonthStart, useOpenBook } from '../workspaces/queries';
import { historyOf } from './budget-view';

export function useBudgetSheet(month: string, enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month], queryFn: () => budgetSheetFor(database, ws, month), enabled });
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

/**
 * What a budget line's Spent is made of, transaction by transaction: the month's rows in these categories, read the way
 * the sheet reads them (bills in their own month, events held out unless the workspace counts them) — so they add up
 * to the line. The wide screen's side peek lists them.
 */
export function useCategoryItems(categoryIds: readonly string[], month: string, enabled = true) {
  const { database, ws } = useApp();
  const monthStart = useMonthStart();
  const eventsInCaps = useOpenBook()?.countEventsInBudget ?? false;
  const { from, to } = monthPeriod(month, monthStart);
  return useQuery({
    queryKey: ['category-items', ws.workspaceId, ws.bookId ?? null, categoryIds.join(','), month, monthStart, eventsInCaps],
    queryFn: () => categoryItemsIn(database, ws, 'expense', categoryIds, from, to, { excludeEvents: !eventsInCaps, billMonths: true }),
    enabled: enabled && categoryIds.length > 0,
  });
}
