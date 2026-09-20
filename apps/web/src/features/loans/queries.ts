import { isoDate } from '@expanses/core';
import { installmentTotals, listInstallments, listLoans, loanFor, nextPaymentDue, scheduledPayments, scheduleFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useLoans() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loans', ws.workspaceId], queryFn: () => listLoans(database, ws) });
}

/** `?? null`: a loan account with no terms yet is not an error, and TanStack Query refuses `undefined`. */
export function useLoan(accountId: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loan', ws.workspaceId, accountId], queryFn: async () => (await loanFor(database, ws, accountId)) ?? null });
}

export function useSchedule(accountId: string, date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({ queryKey: ['loan-schedule', ws.workspaceId, accountId, fromDate], queryFn: () => scheduleFor(database, ws, accountId, fromDate) });
}

/** `?? null`: a paid-off loan has nothing due, which is an answer and not a failure. */
export function useNextPayment(accountId: string, date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({
    queryKey: ['loan-next-payment', ws.workspaceId, accountId, fromDate],
    queryFn: async () => (await nextPaymentDue(database, ws, accountId, fromDate)) ?? null,
  });
}

/** The instalment each loan is due next, by account — what the list prints beside every loan. */
export function useScheduledPayments(date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({ queryKey: ['loan-payments', ws.workspaceId, fromDate], queryFn: () => scheduledPayments(database, ws, fromDate) });
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
