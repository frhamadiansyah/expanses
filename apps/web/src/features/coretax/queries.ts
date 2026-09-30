import { coretaxRows, isoDate, utangRows } from '@expanses/core';
import { businessInputsFor, foreignCurrenciesFor, incomeInputsFor, kmkRateRowsFor, kmkRatesFor, listReports, reportFor, reportInputsFor, rowDifferences, savedRows } from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';

export function useReports() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-reports', ws.workspaceId], queryFn: () => listReports(database, ws) });
}

/**
 * `?? null` because TanStack Query forbids `undefined` as a result and throws `"<hash> data is undefined"`,
 * which the page then paints as a red error box over a year with no report — the commonest state there is.
 * `reportFor` returning `undefined` for "no row" is a fair repo contract; coalescing at the hook is the same
 * thing `useReportRows` below already does with `if (!report) return []`. `null` is legal data, every
 * `report.data` truthiness check keeps working, and `isSuccess` becomes true so the page's own empty state —
 * written long ago and never once rendered — finally shows.
 */
export function useReport(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-report', ws.workspaceId, taxYear], queryFn: async () => (await reportFor(database, ws, taxYear)) ?? null });
}

/**
 * The rows for a year: live from the ledger while the report is a draft, and the saved copy once
 * it has been frozen, which is what makes a later ledger edit show up as a difference.
 */
export function useReportRows(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['tax-rows', ws.workspaceId, taxYear],
    queryFn: async () => {
      const report = await reportFor(database, ws, taxYear);
      if (!report) return [];
      if (report.status !== 'draft') return savedRows(database, ws, taxYear);
      // With one tax ID, the partner's received rows are in the inputs too (joint-net-worth §8.4).
      const { inputs } = await reportInputsFor(database, ws, taxYear);
      const settings = { propertyBasis: report.propertyBasis, repeatRows: report.repeatRows, kmkRateBps: await kmkRatesFor(database, ws, taxYear) };
      return [...coretaxRows(taxYear, inputs, settings), ...utangRows(taxYear, inputs, settings)];
    },
  });
}

/**
 * With one tax ID, whose report it is and what it still waits for (joint-net-worth §8.4); null otherwise. A partner's
 * rows, a year-end and a pending count arrive with a sync run, so the report's live reads are re-read after each one.
 */
export function useJointReport(taxYear: number) {
  const { database, ws, sync } = useApp();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      sync.subscribe(() => {
        void queryClient.invalidateQueries({ queryKey: ['tax-joint', ws.workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['tax-rows', ws.workspaceId] });
        void queryClient.invalidateQueries({ queryKey: ['tax-currencies', ws.workspaceId] });
      }),
    [sync, queryClient, ws.workspaceId],
  );
  return useQuery({ queryKey: ['tax-joint', ws.workspaceId, taxYear], queryFn: async () => (await reportInputsFor(database, ws, taxYear)).joint });
}

/** Last year's saved rows, which this year carries over from. */
export function usePreviousRows(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-rows-previous', ws.workspaceId, taxYear], queryFn: () => savedRows(database, ws, taxYear - 1) });
}

export function useRowDifferences(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-differences', ws.workspaceId, taxYear], queryFn: () => rowDifferences(database, ws, taxYear) });
}

/** The years worth offering, newest first: this one, and every one with a report already. */
export function useReportYears(): number[] {
  const reports = useReports();
  const thisYear = Number(isoDate().slice(0, 4));
  const years = new Set<number>([thisYear, thisYear - 1, ...(reports.data ?? []).map((report) => report.taxYear)]);
  return [...years].sort((a, b) => b - a);
}

/** What each holding paid in the year, and how it is taxed. Live from the ledger; never frozen. */
export function useIncomeRows(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-income', ws.workspaceId, taxYear], queryFn: () => incomeInputsFor(database, ws, taxYear) });
}

export function useBusinessReport(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['tax-business', ws.workspaceId, taxYear],
    queryFn: () => businessInputsFor(database, ws, taxYear),
  });
}

/** The currencies this year actually needs a Menteri Keuangan rate for. */
export function useForeignCurrencies(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['tax-currencies', ws.workspaceId, taxYear],
    queryFn: () => foreignCurrenciesFor(database, ws, taxYear),
  });
}

/** The rates already entered, with the decree each came from. */
export function useKmkRates(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['tax-kmk-rates', ws.workspaceId, taxYear],
    queryFn: () => kmkRateRowsFor(database, ws, taxYear),
  });
}
