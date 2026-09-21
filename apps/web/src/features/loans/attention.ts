import { installmentSplit, monthOf, periodOn, type ScheduleRow } from '@expanses/core';
import type { CardInstallmentRow, LoanTermsRow } from '@expanses/db';
import type { LoanAttention } from '../networth/overview-rows';

/** Warn this long before a payment falls due. §8.3. */
export const PAYMENT_DUE_DAYS = 7;
/** Warn this long before a fixed rate runs out, so the change is not a surprise. */
export const RATE_ENDING_DAYS = 60;

const MS_PER_DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);

export interface LoanAttentionInput {
  loan: LoanTermsRow;
  name: string;
  currency: string;
  /** The payments still to come, soonest first. */
  schedule: ScheduleRow[];
  /** Every instalment plan in the workspace; only the ones ending this month matter. */
  installments: CardInstallmentRow[];
}

/** What one loan needs the owner to know today: a payment coming, a rate ending, a plan finishing. */
export function loanAttention(input: LoanAttentionInput, today: string): LoanAttention {
  const { loan, schedule } = input;
  const next = schedule[0];
  const dueDays = next ? daysBetween(today, next.onDate) : null;
  const paymentDue = loan.status === 'open' && next && dueDays !== null && dueDays >= 0 && dueDays <= PAYMENT_DUE_DAYS ? next : undefined;

  // A fixed rate ends where the next period begins; the last period runs to the end of the loan. Which period is
  // the one running today is `periodOn`'s question and is asked there, not answered a fourth time here.
  const current = periodOn(loan.periods, today);
  // Sorted, so the next period is the soonest one rather than whichever was recorded first.
  const following = [...loan.periods].sort((a, b) => a.fromOn.localeCompare(b.fromOn)).find((period) => period.fromOn > today);
  const endingDays = following ? daysBetween(today, following.fromOn) : null;
  const fixedRateEndsOn =
    loan.status === 'open' && current?.kind === 'fixed' && following && endingDays !== null && endingDays >= 0 && endingDays <= RATE_ENDING_DAYS
      ? following.fromOn
      : null;

  const finishing = input.installments.find((plan) => installmentSplit(plan, today).lastMonth === monthOf(today));

  return {
    accountId: loan.accountId,
    lenderName: input.name,
    currency: input.currency,
    paymentDueMinor: paymentDue ? paymentDue.paymentMinor : null,
    paymentDueOn: paymentDue ? paymentDue.onDate : null,
    fixedRateEndsOn,
    lastInstallmentOf: finishing ? finishing.description : null,
  };
}
