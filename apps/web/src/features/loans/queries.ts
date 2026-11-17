import { isoDate } from '@expanses/core';
import { allPlanInstalmentStatuses, cardHasOpening, cardStatement, cardStatementLines, planCategoryChoices, installmentTotals, listCards, listCardTerms, listInstallments, listLoanItems, listLoans, loanFor, nextPaymentDue, planInstalmentStatuses, scheduledAsks, scheduledPayments, scheduleFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { cycleBack, dueDateAfter } from '../cards/statement-dates';
import type { CardFacts } from '../networth/debt-rows';

export function useLoans() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loans', ws.workspaceId], queryFn: () => listLoans(database, ws) });
}

/**
 * Which kind of loan each classified loan is, by account — the catalogue item the debt was opened as.
 *
 * Read on its own rather than off the loan's terms, because a loan opened from the Accounts page has no terms yet
 * and still knows what kind of debt it is. An account missing from the map was never classified.
 */
export function useLoanItems() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['loan-items', ws.workspaceId], queryFn: () => listLoanItems(database, ws) });
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

/**
 * What each loan asks next, by account: its instalment, the day it falls due, and when the debt ends.
 *
 * The same schedules `useScheduledPayments` reads, so a screen that wants the day and the end date does not pay
 * for a second read of the same thing.
 */
export function useScheduledAsks(date?: string) {
  const { database, ws } = useApp();
  const fromDate = date ?? isoDate();
  return useQuery({ queryKey: ['loan-asks', ws.workspaceId, fromDate], queryFn: () => scheduledAsks(database, ws, fromDate) });
}

export function useInstallments(cardAccountId?: string, enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['installments', ws.workspaceId, cardAccountId ?? 'all'], queryFn: () => listInstallments(database, ws, cardAccountId), enabled });
}

/** The card's statement day, the 1st when none was set: the day each instalment is billed on, as statements read it. */
export function useStatementDay(cardAccountId: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['card-terms', ws.workspaceId, 'statement-day', cardAccountId],
    queryFn: async () => (await listCardTerms(database, ws)).find((terms) => terms.accountId === cardAccountId)?.statementDay ?? 1,
  });
}

/** Every line the card has had, as statements bill them: what a plan's Purchase row offers. Read only when asked for. */
export function useCardLines(cardAccountId: string, enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['card-statement-lines', ws.workspaceId, cardAccountId], enabled, queryFn: () => cardStatementLines(database, ws, cardAccountId) });
}

/** The card's statement day (the 1st when none was set) and due day (null when none): when each instalment is billed and due. */
export function useCardDays(cardAccountId: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['card-terms', ws.workspaceId, 'days', cardAccountId],
    queryFn: async () => {
      const terms = (await listCardTerms(database, ws)).find((row) => row.accountId === cardAccountId);
      return { statementDay: terms?.statementDay ?? 1, dueDay: terms?.dueDay ?? null };
    },
  });
}

/** Whether the card has an opening balance of its own: then a plan's owed rest is inside it, and no line is added (0124). */
export function useCardHasOpening(cardAccountId: string, enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['card-has-opening', ws.workspaceId, cardAccountId], enabled, queryFn: () => cardHasOpening(database, ws, cardAccountId) });
}

/** The Personal workspace's spending categories, which a plan with no purchase can count in. */
export function usePlanCategoryChoices(enabled = true) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['plan-category-choices', ws.workspaceId], enabled, queryFn: () => planCategoryChoices(database, ws) });
}

/** Each instalment of one plan, paid, billed or still to come, on a day. */
export function usePlanInstalments(planId: string, date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['plan-instalments', ws.workspaceId, planId, onDate], queryFn: () => planInstalmentStatuses(database, ws, planId, onDate) });
}

/**
 * Every plan's instalments, paid, billed or still to come, by plan id: the one answer the card's Instalments box,
 * Debt-free and Recurring read, as the plan's own page does (`planInstalmentStatuses`).
 */
export function useAllPlanInstalments(date?: string) {
  const { database, ws } = useApp();
  const onDate = date ?? isoDate();
  return useQuery({ queryKey: ['plan-instalments', ws.workspaceId, 'all', onDate], queryFn: () => allPlanInstalmentStatuses(database, ws, onDate) });
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
