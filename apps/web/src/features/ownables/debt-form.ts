import { addMonths, debtItem, type LoanMethod, monthOf, parseMajor } from '@expanses/core';

/**
 * What a choice on the debt picker turns into, worked out without a browser.
 *
 * A debt is one of three things, and the catalogue already said which when the item was chosen: a loan with a
 * lender and a schedule, money owed to a person the Lend & borrow ledger keeps, or a credit card — which this
 * screen does not open at all, because a card is a statement, a bill, points and instalments, and the card form
 * already knows how to make one.
 */

/** Everything the debt form can ask for, as typed. Strings throughout: the screen types, this file parses. */
export interface DebtItemDraft {
  itemId: string;
  /** What you call it. Empty falls back to the lender, which is what a mortgage is known by anyway. */
  name: string;
  /** What is still owed today, not what was borrowed: the balance is brought in, not the history. */
  owed: string;
  lender: string;
  /** A yearly rate as a percentage, typed "9" or "9,25". */
  rate: string;
  /** Months left to run. Empty means it is not known, and no schedule is worked out. */
  term: string;
  person: string;
  openedOn: string;
}

export const emptyDebtItemDraft = (itemId: string, today: string): DebtItemDraft => ({
  itemId,
  name: '',
  owed: '',
  lender: '',
  rate: '',
  term: '',
  person: '',
  openedOn: today,
});

/** The liability account the debt is opened on, at what is still owed. */
export interface DebtAccountPlan {
  name: string;
  kind: 'liability';
  subtype: 'loan';
  currency: string;
  openingBalanceMinor: number;
  openedOn: string;
}

/** What was agreed, when the months left are known — enough for `saveLoanTerms` once the account exists. */
export interface DebtTermsPlan {
  lenderName: string;
  originalMinor: number;
  firstPaymentOn: string;
  tenorMonths: number;
  method: LoanMethod;
  paymentDay: number;
  rateBps: number;
  coretaxCode: string;
}

/** Money owed to a person, which the Lend & borrow ledger opens and keeps. */
export interface DebtPersonPlan {
  direction: 'borrowed';
  personName: string;
  currency: string;
  balanceMinor: number;
  coretaxCode: string;
  openedOn: string;
}

/**
 * One shape rather than a union, so a caller can read any part of it without narrowing first. A card sets
 * `handOver` and nothing else; everything else leaves `handOver` null and fills in exactly one of the two ways
 * a debt is kept.
 */
export interface NewDebtPlan {
  /** Set when this screen opens nothing and the card form takes over. */
  handOver: 'card' | null;
  account: DebtAccountPlan | null;
  terms: DebtTermsPlan | null;
  person: DebtPersonPlan | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A percentage as basis points: "9,25" is 925. The same rule `loan-form.ts` uses. */
function rateToBps(typed: string): number {
  const cleaned = typed.trim().replace(',', '.');
  if (cleaned === '') return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) throw new Error('The rate must be a number');
  return Math.round(value * 100);
}

/** What is still owed, as minor units, refusing anything that is not a positive amount. */
function owedMinor(typed: string, currency: string): number {
  if (typed.trim() === '') throw new Error('Enter how much is still owed');
  let minor: number;
  try {
    minor = parseMajor(typed, currency);
  } catch {
    throw new Error('The amount must be a number');
  }
  if (!(minor > 0)) throw new Error('Enter how much is still owed');
  return minor;
}

/**
 * Turns a debt as typed into what the database needs, with messages meant for the screen.
 *
 * The payment day is today's, clamped to the 28th so every month has it, and the first payment falls on that day
 * next month: a debt brought in from before the app has already paid this month's instalment, or it would not be
 * being typed in now.
 */
export function planNewDebt(draft: DebtItemDraft, currency: string, today: string): NewDebtPlan {
  const item = debtItem(draft.itemId);
  const { behaviour } = item;
  const empty: NewDebtPlan = { handOver: null, account: null, terms: null, person: null };

  if (behaviour.opens === 'card') return { ...empty, handOver: 'card' };

  if (behaviour.opens === 'person') {
    const personName = draft.person.trim();
    if (!personName) throw new Error('Say who this is with');
    return {
      ...empty,
      person: { direction: 'borrowed', personName, currency, balanceMinor: owedMinor(draft.owed, currency), coretaxCode: item.code, openedOn: draft.openedOn },
    };
  }

  // Only a card, a person and a loan are debts; the catalogue's other behaviours belong to things you own.
  if (behaviour.opens !== 'loan') throw new Error(`“${item.label}” is not a debt`);

  const lenderName = draft.lender.trim();
  if (!lenderName) throw new Error('Say who lent the money');
  const originalMinor = owedMinor(draft.owed, currency);
  const account: DebtAccountPlan = {
    name: draft.name.trim() || lenderName,
    kind: 'liability',
    subtype: 'loan',
    currency,
    openingBalanceMinor: originalMinor,
    openedOn: draft.openedOn,
  };

  // Months left are what makes a schedule possible. Without them the account still opens, at what is owed.
  if (draft.term.trim() === '') return { ...empty, account };
  const tenorMonths = Number(draft.term.trim());
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) throw new Error('A loan runs for at least one month');

  const paymentDay = Math.min(Number(today.slice(8, 10)), 28);
  // A paylater is never asked for a rate, so its typed one — if the field ever showed — is not read.
  const rateBps = behaviour.asksRate ? rateToBps(draft.rate) : 0;
  return {
    ...empty,
    account,
    terms: {
      lenderName,
      originalMinor,
      firstPaymentOn: `${addMonths(monthOf(today), 1)}-${pad(paymentDay)}`,
      tenorMonths,
      method: rateBps > 0 ? 'annuity' : 'zero',
      paymentDay,
      rateBps,
      coretaxCode: item.code,
    },
  };
}
