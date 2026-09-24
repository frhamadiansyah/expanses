import { isoDate, type ScheduleRow } from '@expanses/core';
import { expiringSoonAcross, nativeBalances, scheduleFor } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { usePeopleDebts } from '../debts/queries';
import { useGoalPlans, useSetAsideViews } from '../goals/queries';
import { loanAttention } from '../loans/attention';
import { useInstallments, useLoans } from '../loans/queries';
import { attentionItems } from './overview-rows';
import { useAssetValues, useDueTemplates, useIdleCash } from './queries';

/** Each open loan's schedule, keyed by account, so the attention rows can read the next payment. */
function useLoanSchedules(loans: { accountId: string }[], today: string): Record<string, ScheduleRow[]> {
  const { database, ws } = useApp();
  const results = useQueries({
    queries: loans.map((loan) => ({
      queryKey: ['loan-schedule', ws.workspaceId, loan.accountId, today],
      queryFn: () => scheduleFor(database, ws, loan.accountId, today),
    })),
  });
  const byAccount: Record<string, ScheduleRow[]> = {};
  loans.forEach((loan, index) => {
    byAccount[loan.accountId] = (results[index]?.data as ScheduleRow[] | undefined) ?? [];
  });
  return byAccount;
}

/**
 * What is waiting to be dealt with, and the warnings that are not rows.
 *
 * One hook rather than the same eight queries written out on two screens: the Net worth page keeps the corner that
 * counts them, and the screen behind that corner draws them. Both read the same cached queries, so the count costs no
 * second read of anything.
 *
 * The month's own spending and income and what the cards owe used to be computed alongside these and are not here any
 * more: the Cashflow screen answers those two questions and the Cards screen the third, and a figure drawn on two
 * screens is a figure that can disagree with itself.
 */
export function useAttention(today: string = isoDate()) {
  const { database, ws } = useApp();
  const values = useAssetValues();
  const due = useDueTemplates();
  const idle = useIdleCash();
  const people = usePeopleDebts(today);
  const loans = useLoans();
  const installments = useInstallments();
  const schedules = useLoanSchedules(loans.data ?? [], today);
  const goalSummary = useGoalPlans(today);
  const setAsideViews = useSetAsideViews();
  const accounts = useAccounts();
  const money = (accounts.data ?? []).filter(isMoneyAccount);
  const resolveRates = useResolveRates();

  const balances = useQuery({
    queryKey: ['net-worth-balances', ws.workspaceId, today, money.length],
    enabled: accounts.isSuccess,
    queryFn: async () => {
      const rows = await nativeBalances(database, ws);
      // The rates are read here only for whether they have gone stale: the figures themselves are the sheet's.
      const rates = await resolveRates(
        money.map((account) => account.currency!),
        today,
      );
      return { rows, stale: rates.stale };
    },
  });

  // Reporting only: dead points are written off when a card is opened, never by looking at a summary.
  const expiring = useQuery({ queryKey: ['points-expiring', ws.workspaceId, today], queryFn: () => expiringSoonAcross(database, ws, today) });

  const items = attentionItems(
    values.data ?? [],
    due.data ?? [],
    goalSummary.data?.plans ?? [],
    idle.data ?? [],
    [...(people.data?.owedToYou ?? []), ...(people.data?.youOwe ?? [])],
    (loans.data ?? []).map((loan) =>
      loanAttention(
        {
          loan,
          name: loan.lenderName,
          currency: ws.baseCurrency,
          schedule: schedules[loan.accountId] ?? [],
          installments: installments.data ?? [],
        },
        today,
      ),
    ),
    Object.values(setAsideViews.data ?? {}),
  );

  /*
   * A rate that has gone stale, and points about to lapse. A *missing* rate is not among them: the figure and the line
   * already name every rate they lack, and saying the same thing twice reads as two problems.
   */
  const warnings = [
    ...(balances.data?.stale ?? []).map((currency) => `${currency} rate is out of date`),
    ...(expiring.data ?? []).map((row) => `${row.expiringSoon.toLocaleString('id-ID')} ${row.unit} on ${row.cardName} expire on ${row.nextExpiryOn}`),
  ];

  return { items, warnings, error: values.error };
}
