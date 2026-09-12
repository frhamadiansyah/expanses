import { isoDate } from '@expanses/core';
import { installmentTotals, listInstallments, listLoans, loanFor, nextPaymentDue, scheduleFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useLoans() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loans', ws.workspaceId], queryFn: () => listLoans(database, ws) });
}

export function useLoan(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loan', ws.workspaceId, accountId], queryFn: () => loanFor(database, ws, accountId) });
}

export function useSchedule(accountId: string, date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({ queryKey: ['loan-schedule', ws.workspaceId, accountId, fromDate], queryFn: () => scheduleFor(database, ws, accountId, fromDate) });
}

export function useNextPayment(accountId: string, date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({ queryKey: ['loan-next-payment', ws.workspaceId, accountId, fromDate], queryFn: () => nextPaymentDue(database, ws, accountId, fromDate) });
}

export function useInstallments(cardAccountId?: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['installments', ws.workspaceId, cardAccountId ?? 'all'], queryFn: () => listInstallments(database, ws, cardAccountId) });
}

export function useInstallmentTotals(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['installment-totals', ws.workspaceId, onDate], queryFn: () => installmentTotals(database, ws, onDate) });
}
