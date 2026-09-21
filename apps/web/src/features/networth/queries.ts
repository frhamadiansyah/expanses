import { isoDate } from '@expanses/core';
import {
  assetValuesAt,
  netWorthSeries,
  periodFlows,
  sheetInputsAt,
  dueTemplates,
  getAssetProfile,
  getDepositAutomation,
  idleCash,
  listAssetProfiles,
  listDepositTerms,
  listDueDeposits,
  listPrices,
  listTradeTemplates,
  listTrades,
  listUndoableByHand,
  listValuations,
  monthEndValues,
  ownerScope,
  positionsFor,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';

export function useAssetValues(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['asset-values', ws.workspaceId, onDate], queryFn: () => assetValuesAt(database, ws, onDate) });
}

export function useIdleCash(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['idle-cash', ws.workspaceId, onDate], queryFn: () => idleCash(database, ws, onDate) });
}

export function useAssetProfiles() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['asset-profiles', ws.workspaceId], queryFn: () => listAssetProfiles(database, ws) });
}

export function useAssetProfile(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['asset-profile', ws.workspaceId, accountId], queryFn: () => getAssetProfile(database, ws, accountId) });
}

/** Every time deposit's maturity and rate, so a page can say them back beside the account they belong to. */
export function useDepositTerms() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-terms', ws.workspaceId], queryFn: () => listDepositTerms(database, ws) });
}

export function useTrades(accountId?: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['trades', ws.workspaceId, accountId ?? 'all'], queryFn: () => listTrades(database, ws, { accountId }) });
}

export function usePositions() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['positions', ws.workspaceId], queryFn: () => positionsFor(database, ws) });
}

export function usePrices(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['prices', ws.workspaceId, accountId], queryFn: () => listPrices(database, ws, accountId) });
}

export function useValuations(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['valuations', ws.workspaceId, accountId], queryFn: () => listValuations(database, ws, accountId) });
}

export function useMonthEndValues(accountId: string, months: string[]) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['month-end-values', ws.workspaceId, accountId, months.join(',')], queryFn: () => monthEndValues(database, ws, accountId, months) });
}

export function useTradeTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['trade-templates', ws.workspaceId], queryFn: () => listTradeTemplates(database, ws) });
}

export function useDueTemplates(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['due-templates', ws.workspaceId, onDate], queryFn: () => dueTemplates(database, ws, onDate) });
}

/** Rates for every currency the workspace holds money in, fetched or manual, as the dashboard does. */
function useMoneyCurrencies(): string[] {
  const { ws } = useApp();
  const accounts = useAccounts();
  return [...new Set((accounts.data ?? []).filter(isMoneyAccount).map((account) => account.currency ?? ws.baseCurrency))];
}

export function useNetWorthSeries(months: string[]) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const currencies = useMoneyCurrencies();
  const today = isoDate();
  return useQuery({
    queryKey: ['net-worth-series', ws.workspaceId, months.join(','), currencies.join(',')],
    queryFn: async () => {
      const rates = await resolveRates(currencies, today);
      return netWorthSeries(database, ws, months, rates.rates, today);
    },
  });
}

export function useSheet(date?: string) {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const currencies = useMoneyCurrencies();
  const onDate = date ?? isoDate();
  return useQuery({
    queryKey: ['sheet-inputs', ws.workspaceId, onDate, currencies.join(',')],
    queryFn: async () => {
      const rates = await resolveRates(currencies, onDate);
      return sheetInputsAt(database, ws, onDate, rates.rates);
    },
  });
}

export function usePeriodFlows(range: { from: string; to: string }) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['period-flows', ws.workspaceId, range.from, range.to],
    // Net worth is the owner's whole picture: every workspace, in the owner's own currency.
    queryFn: () => periodFlows(database, ownerScope(ws), range),
  });
}

/** One deposit's automation settings; a deposit with none reads as off. */
export function useDepositAutomation(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-automation', ws.workspaceId, accountId], queryFn: () => getDepositAutomation(database, ws, accountId) });
}

/** What every automated deposit has due today or earlier: the proposal on its page, the marker on its row. */
export function useDueDeposits() {
  const { database, ws } = useApp();
  const today = isoDate();
  return useQuery({ queryKey: ['deposit-due', ws.workspaceId, today], queryFn: () => listDueDeposits(database, ws, today) });
}

/** The deposit's hand-recorded events that "Undo recorded by hand" can take back now. */
export function useUndoableByHand(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['deposit-by-hand', ws.workspaceId, accountId], queryFn: () => listUndoableByHand(database, ws, accountId) });
}
