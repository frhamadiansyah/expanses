import { billDetail, bookMoneyFor, monthlyBills, sinkingFundViews, yearlyBills } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useMonthlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => monthlyBills(database, ws, today) });
}

export function useYearlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', 'yearly', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => yearlyBills(database, ws, today) });
}

export function useBillDetail(billId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-detail', ws.workspaceId, ws.bookId ?? null, billId, today], queryFn: () => billDetail(database, ws, billId, today) });
}

/**
 * The workspace's money for adding bills up: `useBookMoney`, with a foreign conversion on top so a bill written in
 * another currency than the money its workspace reads in (an SGD bill in a rupiah workspace) can be brought across.
 */
export function useBillMoney() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['book-money-bills', ws.workspaceId, ws.bookId ?? null], queryFn: () => bookMoneyFor(database, ws, { foreign: true }) });
}

/** Every yearly bill saving up, with what is set aside today. Local to the owner: never part of a shared workspace. */
export function useSinkingFunds(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['sinking-funds', ws.workspaceId, today], queryFn: () => sinkingFundViews(database, ws, today) });
}
