import { isoDate } from '@expanses/core';
import { cardStatement, installmentTotals, listCards, listCardTerms, listInstallments, listLoans, loanFor, nextPaymentDue, scheduledPayments, scheduleFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { cycleBack, dueDateAfter } from '../cards/statement-dates';
import type { CardFacts } from '../networth/debt-rows';

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

/**
 * What each credit card's last statement says, for the Debts page: the bill, what is left of it, and when it is
 * due. Read through `cardStatement` for the same cycle the card's own page reads, never rebuilt from the lines.
 */
export function useCardFacts(cardAccountIds: readonly string[], date?: string) {
  const { database, ws } = useApp();
  const today = date ?? isoDate();
  const ids = [...cardAccountIds].sort();
  return useQuery({
    queryKey: ['debt-card-facts', ws.workspaceId, today, ids.join(',')],
    queryFn: async (): Promise<Record<string, CardFacts>> => {
      const [terms, plastic] = await Promise.all([listCardTerms(database, ws), listCards(database, ws)]);
      const facts: Record<string, CardFacts> = {};
      for (const id of ids) {
        const own = plastic.filter((card) => card.accountId === id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
        const last4 = own.find((card) => card.last4 !== null)?.last4 ?? null;
        const term = terms.find((row) => row.accountId === id);
        if (!term) {
          facts[id] = { last4, hasTerms: false, dueOn: null, billedMinor: 0, leftToPayMinor: 0 };
          continue;
        }
        const cycle = cycleBack(today, term.statementDay, 1);
        const statement = await cardStatement(database, ws, id, cycle, today);
        const left = statement.leftToPayMinor ?? 0;
        facts[id] = { last4, hasTerms: true, dueOn: left > 0 ? dueDateAfter(cycle.end, term.dueDay) : null, billedMinor: statement.closingMinor, leftToPayMinor: left };
      }
      return facts;
    },
  });
}
