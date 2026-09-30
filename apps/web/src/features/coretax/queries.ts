import { coretaxRows, isoDate, utangRows } from '@expanses/core';
import {
  businessInputsFor,
  type Database,
  foreignCurrenciesOf,
  incomeInputsFor,
  kmkRateRowsFor,
  kmkRatesFor,
  listReports,
  reportFor,
  reportInputsFor,
  rowDifferences,
  savedRows,
  type WorkspaceContext,
} from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApp } from '../../app/context';
import { useActiveNetWorthGroup } from '../sharing/net-worth-queries';

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
 * Which group the report's inputs are read under: a mode change or a new proposal arrives with a sync run and the
 * net-worth queries re-read it, so the inputs' key moves with it. `undefined` while it is still being read.
 */
function useGroupKey(): string | null | undefined {
  const active = useActiveNetWorthGroup();
  if (active.isPending) return undefined;
  return active.data ? `${active.data.proposalId}:${active.data.mode}` : null;
}

/**
 * The year's inputs — this phone's own, plus with one tax ID each received row (joint-net-worth §8.4) — read once and
 * shared by the rows, the joint banner and the currencies that need a KMK rate.
 */
function inputsQuery(database: Database, ws: WorkspaceContext, taxYear: number, groupKey: string | null | undefined) {
  return { queryKey: ['tax-inputs', ws.workspaceId, taxYear, groupKey ?? null], queryFn: () => reportInputsFor(database, ws, taxYear) };
}

/**
 * The rows for a year: live from the ledger while the report is a draft, and the saved copy once
 * it has been frozen, which is what makes a later ledger edit show up as a difference.
 */
export function useReportRows(taxYear: number) {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  const groupKey = useGroupKey();
  return useQuery({
    queryKey: ['tax-rows', ws.workspaceId, taxYear, groupKey ?? null],
    enabled: groupKey !== undefined,
    queryFn: async () => {
      const report = await reportFor(database, ws, taxYear);
      if (!report) return [];
      if (report.status !== 'draft') return savedRows(database, ws, taxYear);
      const { inputs } = await queryClient.fetchQuery(inputsQuery(database, ws, taxYear, groupKey));
      const settings = { propertyBasis: report.propertyBasis, repeatRows: report.repeatRows, kmkRateBps: await kmkRatesFor(database, ws, taxYear) };
      return [...coretaxRows(taxYear, inputs, settings), ...utangRows(taxYear, inputs, settings)];
    },
  });
}

/**
 * With one tax ID, whose report it is and what it still waits for (joint-net-worth §8.4); null otherwise. A partner's
 * rows, a year-end and a pending count arrive with a sync run, so while the group files jointly the report's live reads
 * are re-read after each one; otherwise a sync run changes nothing here and nothing is re-read.
 */
export function useJointReport(taxYear: number) {
  const { database, ws, sync } = useApp();
  const queryClient = useQueryClient();
  const groupKey = useGroupKey();
  const joint = groupKey?.endsWith(':joint') ?? false;
  useEffect(() => {
    if (!joint) return undefined;
    return sync.subscribe(() => {
      for (const key of ['tax-inputs', 'tax-rows']) void queryClient.invalidateQueries({ queryKey: [key, ws.workspaceId] });
    });
  }, [joint, sync, queryClient, ws.workspaceId]);
  return useQuery({ ...inputsQuery(database, ws, taxYear, groupKey), enabled: groupKey !== undefined, select: (read) => read.joint });
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
  const groupKey = useGroupKey();
  // With one tax ID the partner's currencies need rates too: read from the same inputs as the rows.
  return useQuery({
    ...inputsQuery(database, ws, taxYear, groupKey),
    enabled: groupKey !== undefined,
    select: (read) => foreignCurrenciesOf(read.inputs, ws.baseCurrency),
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
