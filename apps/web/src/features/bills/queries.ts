import { billDetail, monthlyBills } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useMonthlyBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', ws.workspaceId, ws.bookId ?? null, today], queryFn: () => monthlyBills(database, ws, today) });
}

export function useBillDetail(billId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['bill-detail', ws.workspaceId, ws.bookId ?? null, billId, today], queryFn: () => billDetail(database, ws, billId, today) });
}
