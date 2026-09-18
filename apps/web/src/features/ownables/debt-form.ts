import type { CatalogEntry } from '@expanses/catalog';
import { addMonths, debtItem, type LoanMethod, monthOf, parseMajor } from '@expanses/core';
import { memberLevelsOf } from '../cards/catalog-picker';

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

/** What the card form asks for, as typed. The chosen catalogue entry is passed beside it, not held in here. */
export interface NewCardDraft {
  name: string;
  /** The bank, when the card is typed by hand. A catalogue card is told its bank by the entry. */
  issuer: string;
  last4: string;
  owed: string;
  /** The holder's standing with the bank, for an entry that publishes levels. */
  memberLevel: string;
  statementDay: string;
  dueDay: string;
}

export const emptyNewCardDraft = (): NewCardDraft => ({ name: '', issuer: '', last4: '', owed: '', memberLevel: '', statementDay: '', dueDay: '' });

export interface NewCardPlan {
  name: string;
  issuer: string | null;
  last4: string | null;
  currency: string;
  openingBalanceMinor: number;
  /** The level to apply the entry at, when it publishes any. */
  memberLevel: string | null;
  /** The billing cycle, or null when neither day was given — which only a card typed by hand may do. */
  terms: { statementDay: number; dueDay: number } | null;
}

/** A day of the month `card_terms` will accept. `saveCardTerms` takes 1-31; this says so before anything is written. */
function dayOfMonth(typed: string, label: string): number {
  const day = Number(typed.trim());
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error(`The ${label} is a day of the month, 1 to 31`);
  return day;
}

/**
 * Everything that can be refused about a new card, worked out before a single row is written.
 *
 * Opening the account first and validating afterwards is what makes a half-made card: the account is committed,
 * the error is shown, and pressing the button again either opens a second one or is turned away by the duplicate
 * check on the last four digits — leaving no way to finish. So every refusal the steps after it could raise is
 * raised here instead, with the entry's own conditions among them.
 */
export function planNewCard(draft: NewCardDraft, entry: CatalogEntry | null, baseCurrency: string): NewCardPlan {
  const name = draft.name.trim();
  if (!name) throw new Error('Give the card a name');

  const levels = entry ? memberLevelsOf(entry) : [];
  const memberLevel = draft.memberLevel.trim();
  // The same condition `applyCatalogEntry` enforces, asked before the account exists rather than after.
  if (levels.length > 0 && !levels.some((level) => level.key === memberLevel)) {
    throw new Error(`This card earns by ${entry?.program.name} level. Choose the level you are on before adding it.`);
  }

  const currency = entry?.currency ?? baseCurrency;
  let openingBalanceMinor = 0;
  if (draft.owed.trim() !== '') {
    try {
      openingBalanceMinor = parseMajor(draft.owed, currency);
    } catch {
      throw new Error('The amount must be a number');
    }
  }

  const someDay = draft.statementDay.trim() !== '' || draft.dueDay.trim() !== '';
  // The published fee is kept on the card's terms, and the terms need both days, so a catalogue card is asked.
  if (entry && !someDay) throw new Error('A card from the catalogue needs its billing date and due date: that is where its fee and its cycle are kept');
  const terms = someDay ? { statementDay: dayOfMonth(draft.statementDay, 'billing date'), dueDay: dayOfMonth(draft.dueDay, 'due date') } : null;

  return {
    name,
    issuer: entry ? entry.bank : draft.issuer.trim() || null,
    last4: draft.last4.trim() || null,
    currency,
    openingBalanceMinor,
    memberLevel: memberLevel || null,
    terms,
  };
}
