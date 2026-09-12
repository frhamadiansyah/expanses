import { isoDate, type LoanMethod, minorToMajorString, parseMajor, type ScheduleRow } from '@expanses/core';
import type { LoanPaymentInput, SaveLoanTermsInput } from '@expanses/db';

export interface LoanTermsDraft {
  accountId: string;
  lenderName: string;
  purpose: string;
  originalAmount: string;
  firstPaymentOn: string;
  tenorMonths: string;
  method: LoanMethod;
  paymentDay: string;
  /** A yearly rate as a percentage, typed "9" or "9,25". */
  rate: string;
  /** What the bank actually asks for each month, when it names a figure. */
  payment: string;
  rateKind: 'fixed' | 'floating';
  assetAccountId: string;
  lenderNpwp: string;
}

export const emptyLoanTermsDraft = (accountId: string, today: string): LoanTermsDraft => ({
  accountId,
  lenderName: '',
  purpose: '',
  originalAmount: '',
  firstPaymentOn: today,
  tenorMonths: '',
  method: 'annuity',
  paymentDay: '25',
  rate: '',
  payment: '',
  rateKind: 'fixed',
  assetAccountId: '',
  lenderNpwp: '',
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A percentage as basis points: "9,25" is 925. */
function rateToBps(typed: string): number {
  const cleaned = typed.trim().replace(',', '.');
  if (cleaned === '') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new Error('The rate must be a number');
  return Math.round(value * 100);
}

/** Turns the terms as typed into what the database needs, with messages meant for the screen. */
export function loanTermsDraftToInput(draft: LoanTermsDraft, currency: string): SaveLoanTermsInput {
  const lenderName = draft.lenderName.trim();
  if (!lenderName) throw new Error('Say who lent the money');
  if (!DATE.test(draft.firstPaymentOn)) throw new Error('Choose the date of the first payment');

  if (draft.originalAmount.trim() === '') throw new Error('Enter how much was borrowed');
  let originalMinor: number;
  try {
    originalMinor = parseMajor(draft.originalAmount, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (!(originalMinor > 0)) throw new Error('Enter how much was borrowed');

  const tenorMonths = Number(draft.tenorMonths.trim());
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) throw new Error('A loan runs for at least one month');
  const paymentDay = Number(draft.paymentDay.trim());
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 28) throw new Error('Pick a payment day between 1 and 28, so every month has it');

  let paymentMinor = 0;
  if (draft.payment.trim() !== '') {
    try {
      paymentMinor = parseMajor(draft.payment, currency);
    } catch {
      throw new Error('The payment must be a number');
    }
  }

  return {
    accountId: draft.accountId,
    lenderName,
    lenderNpwp: draft.lenderNpwp.trim() || null,
    purpose: draft.purpose.trim() || null,
    originalMinor,
    firstPaymentOn: draft.firstPaymentOn,
    tenorMonths,
    method: draft.method,
    paymentDay,
    assetAccountId: draft.assetAccountId || null,
    rateBps: rateToBps(draft.rate),
    paymentMinor,
    rateKind: draft.rateKind,
  };
}

export interface PaymentDraft {
  occurredOn: string;
  moneyId: string;
  principal: string;
  interest: string;
  /** Admin charges or insurance riding on the same payment. */
  extras: { categoryId: string; amount: string }[];
}

/**
 * Fills the payment form in from the row the schedule says is next. Nothing is guessed, and a row
 * that falls due later is dated today: the split is what the schedule says, the date is when the
 * money actually moves. A row already past keeps its own date, so a late payment records truthfully.
 */
export function paymentDraftFrom(row: ScheduleRow | undefined, today: string, moneyId: string, currency: string): PaymentDraft {
  if (!row) return { occurredOn: today, moneyId, principal: '', interest: '', extras: [] };
  return {
    occurredOn: row.onDate > today ? today : row.onDate,
    moneyId,
    principal: minorToMajorString(row.principalMinor, currency),
    interest: minorToMajorString(row.interestMinor, currency),
    extras: [],
  };
}

/** Turns a payment as typed into one to record, refusing more principal than is left. */
export function paymentDraftToInput(
  draft: PaymentDraft,
  accountId: string,
  currency: string,
  balanceMinor: number,
  loanName: string,
  today: string = isoDate(),
): LoanPaymentInput {
  if (!DATE.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A payment cannot be dated after today');
  if (!draft.moneyId) throw new Error('Choose which account paid');

  const amount = (typed: string, what: string): number => {
    if (typed.trim() === '') return 0;
    try {
      return parseMajor(typed, currency);
    } catch {
      throw new Error(`The ${what} must be a number`);
    }
  };
  const principalMinor = amount(draft.principal, 'principal');
  const interestMinor = amount(draft.interest, 'interest');
  if (principalMinor + interestMinor <= 0) throw new Error('Enter what was paid');
  if (principalMinor > balanceMinor) throw new Error(`${loanName} has less than that left to pay off`);

  return {
    accountId,
    occurredOn: draft.occurredOn,
    moneyAccountId: draft.moneyId,
    principalMinor,
    interestMinor,
    extras: draft.extras
      .filter((extra) => extra.categoryId && extra.amount.trim() !== '')
      .map((extra) => ({ categoryId: extra.categoryId, amountMinor: amount(extra.amount, 'amount') })),
  };
}
