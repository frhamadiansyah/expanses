import { firstBilledMonthFor, formatMinor, installmentSchedule, monthName, roundHalfAwayFromZero } from '@expanses/core';
import type { AccountRow, CardInstallmentRow, SaveInstallmentInput, TransactionView } from '@expanses/db';
import { classify } from './classify';

/*
 * Turn into instalments, from the purchase itself (owner, 16 Nov 2026, option A): a credit card purchase's receipt gets
 * an Instalments row; its sheet asks only the months, the first billed month and the interest. Name, amount, card and
 * purchase come from the purchase, and a plan made here always counts Each month, tied to it.
 */

export const MONTH_CHOICES = [3, 6, 12, 24] as const;

export interface TurnForm {
  /** One of the chips, or Other with its own number. */
  months: number | 'other';
  other: string;
  firstBilledMonth: string;
  /** A year's percentage as typed ("0", "2,5"). Kept with the plan; the instalments are the total over the months. */
  interest: string;
}

/** The sheet as it opens: twelve months, first billed after the purchase's own statement, 0%. */
export const blankTurnForm = (occurredOn: string, statementDay: number): TurnForm => ({
  months: 12,
  other: '',
  firstBilledMonth: firstBilledMonthFor(occurredOn, statementDay),
  interest: '0',
});

/** The months the form says, or null while Other holds no whole number from 1. */
export function turnMonths(form: TurnForm): number | null {
  if (form.months !== 'other') return form.months;
  const n = Number(form.other.trim());
  return Number.isInteger(n) && n >= 1 && n <= 120 ? n : null;
}

/** The interest as basis points, or null when it does not read as a percentage from 0. */
export function interestBps(text: string): number | null {
  const value = Number(text.trim().replace('%', '').replace(',', '.') || '0');
  return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value * 100) : null;
}

/** What a month comes to: the total over the months, the last one carrying the rounding (as `saveInstallment` keeps it). */
export const eachMonthOf = (amountMinor: number, months: number) => roundHalfAwayFromZero(amountMinor / months);

/** The plan this sheet saves, or null while the form cannot be saved. */
export function turnIntoInput(
  purchase: { transactionId: string; description: string; amountMinor: number },
  cardAccountId: string,
  form: TurnForm,
): SaveInstallmentInput | null {
  const months = turnMonths(form);
  const rateBps = interestBps(form.interest);
  if (months === null || rateBps === null || !(purchase.amountMinor > 0) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.firstBilledMonth)) return null;
  return {
    cardAccountId,
    description: purchase.description.trim() || 'Instalment plan',
    totalMinor: purchase.amountMinor,
    months,
    firstBilledMonth: form.firstBilledMonth,
    transactionId: purchase.transactionId,
    countMode: 'each_month',
    rateBps,
    earnsPoints: false,
  };
}

const monthYearWords = (month: string) => `${monthName(month, 'long')} ${month.slice(0, 4)}`;

/** "Rp 2.000.000 counts as spending in each month from December 2026 to May 2027." */
export function turnFooter(amountMinor: number, months: number | null, firstBilledMonth: string, statementDay: number, currency: string): string | undefined {
  if (months === null || !(amountMinor > 0) || !/^\d{4}-\d{2}$/.test(firstBilledMonth)) return undefined;
  const plan = { totalMinor: amountMinor, months, monthlyMinor: eachMonthOf(amountMinor, months), firstBilledMonth, rateBps: 0, conversionFeeMinor: 0, earnsPoints: false };
  const schedule = installmentSchedule(plan, statementDay);
  const first = schedule[0]!.statementOn.slice(0, 7);
  const last = schedule.at(-1)!.statementOn.slice(0, 7);
  const span = first === last ? `in ${monthYearWords(first)}` : `in each month from ${monthYearWords(first)} to ${monthYearWords(last)}`;
  return `${formatMinor(plan.monthlyMinor, currency)} counts as spending ${span}.`;
}

/**
 * The card a purchase can be turned into instalments on: a posted purchase paid with one of this phone's own credit
 * cards, and nothing else. Null for a debit card, cash, a deleted row, or a card on another member's placeholder.
 */
export function instalmentCardOf(tx: Pick<TransactionView, 'status' | 'entries'>, own: readonly Pick<AccountRow, 'id' | 'subtype'>[]): { cardAccountId: string; amountMinor: number } | null {
  if (tx.status !== 'posted') return null;
  if (classify(tx as TransactionView).type !== 'expense') return null;
  const money = tx.entries.filter((entry) => entry.accountKind === 'asset' || entry.accountKind === 'liability');
  const ids = [...new Set(money.map((entry) => entry.accountId))];
  if (ids.length !== 1) return null;
  const card = own.find((account) => account.id === ids[0]);
  if (!card || card.subtype !== 'credit_card') return null;
  const charged = -money.reduce((sum, entry) => sum + entry.amountMinor, 0);
  return charged > 0 ? { cardAccountId: card.id, amountMinor: charged } : null;
}

/** The Instalments row's value: "None", or "6 × Rp 2.000.000" for the plan tied to the purchase. */
export const instalmentRowValue = (plan: Pick<CardInstallmentRow, 'months' | 'monthlyMinor'> | null, currency: string): string =>
  plan ? `${plan.months} × ${formatMinor(plan.monthlyMinor, currency)}` : 'None';

/** The hero's caption for a purchase its plan spreads: "Spread over 6 months · counts Rp 0 now". Null otherwise. */
export function spreadCaption(plan: Pick<CardInstallmentRow, 'months' | 'countMode'> | null, currency: string): string | null {
  return plan && plan.countMode === 'each_month' ? `Spread over ${plan.months} months · counts ${formatMinor(0, currency)} now` : null;
}
