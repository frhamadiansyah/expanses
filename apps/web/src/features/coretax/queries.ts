import { coretaxRows, isoDate, utangRows } from '@expanses/core';
import { coretaxInputsFor, incomeInputsFor, listReports, reportFor, rowDifferences, savedRows } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useReports() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-reports', ws.workspaceId], queryFn: () => listReports(database, ws) });
}

export function useReport(taxYear: number) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['tax-report', ws.workspaceId, taxYear], queryFn: () => reportFor(database, ws, taxYear) });
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
      const inputs = await coretaxInputsFor(database, ws, taxYear);
      const settings = { propertyBasis: report.propertyBasis, repeatRows: report.repeatRows, kmkRateBps: {} };
      return [...coretaxRows(taxYear, inputs, settings), ...utangRows(taxYear, inputs, settings)];
    },
  });
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
