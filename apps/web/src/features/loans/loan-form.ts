import { isoDate, type LoanMethod, minorToMajorString, parseMajor, periodOn, type ScheduleRow } from '@expanses/core';
import type { LoanPaymentInput, LoanTermsRow, SaveLoanTermsInput } from '@expanses/db';

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

/**
 * The terms already on file, as the form holds them — what Edit terms opens with, so a wrong tenor or a renamed
 * lender can be put right without starting over.
 *
 * The rate and the payment come from the period in force today rather than the first one: a loan that has had a
 * rate change since should be corrected from what it pays now.
 */
export function loanTermsDraftFromTerms(terms: LoanTermsRow, currency: string, today: string): LoanTermsDraft {
  const current = periodOn(terms.periods, today) ?? terms.periods[terms.periods.length - 1];
  const rate = current ? Number((current.rateBps / 100).toFixed(2)).toString().replace('.', ',') : '';
  return {
    accountId: terms.accountId,
    lenderName: terms.lenderName,
    purpose: terms.purpose ?? '',
    originalAmount: minorToMajorString(terms.originalMinor, currency),
    firstPaymentOn: terms.firstPaymentOn,
    tenorMonths: String(terms.tenorMonths),
    method: terms.method,
    paymentDay: String(terms.paymentDay),
    rate,
    payment: current && current.paymentMinor > 0 ? minorToMajorString(current.paymentMinor, currency) : '',
    rateKind: current?.kind ?? 'fixed',
    assetAccountId: terms.assetAccountId ?? '',
    lenderNpwp: terms.lenderNpwp ?? '',
  };
}

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
export function paymentDraftFrom(row: ScheduleRow | null | undefined, today: string, moneyId: string, currency: string): PaymentDraft {
  if (!row) return { occurredOn: today, moneyId, principal: '', interest: '', extras: [] };
  return {
    occurredOn: row.onDate > today ? today : row.onDate,
    moneyId,
    principal: minorToMajorString(row.principalMinor, currency),
    interest: minorToMajorString(row.interestMinor, currency),
    extras: [],
  };
}

/**
 * A figure typed into one of the extra payment's two boxes — the extra itself, and the bank's penalty — in the
 * loan's own money, in minor units. An empty box is nothing, which is a real answer for a penalty.
 *
 * The app's own reader, so what is typed is money in the currency the box names: "1.500.000" is one and a half
 * million rupiah, and on a dollar loan "12,50" is twelve dollars and fifty cents. Both boxes used to be read with
 * `Number(x.replace(/\./g, ''))`, which is right for a rupiah figure and answers a dollar one with `NaN` — a
 * penalty the bank charged that was posted as nothing, and a NaN that rode into the ledger beside it. A figure
 * neither spelling can read — rupiah with cents on it, say — now comes back in the reader's own words.
 */
export function extraPaymentMinor(typed: string, currency: string): number {
  if (typed.trim() === '') return 0;
  return parseMajor(typed, currency);
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
