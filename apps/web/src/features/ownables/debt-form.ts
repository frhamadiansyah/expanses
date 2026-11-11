import type { CatalogEntry } from '@expanses/catalog';
import { addMonths, calculatorLoan, debtItem, type LoanCalcStage, type LoanMethod, MAX_LOAN_MONTHS, MAX_LOAN_RATE_BPS, monthOf, parseMajor, paymentDate, rateBpsFromTyped } from '@expanses/core';
import { memberLevelsOf } from '../cards/catalog-picker';
import { longMonth } from '../debt-plan/plan-view';
import { rateTextPer } from '../loans/loan-view';

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
  /** A rate as a percentage, typed "9" or "9,25": a year for a loan, a month for a paylater (`ratePer` in the catalogue). */
  rate: string;
  /** Months left to run. Empty means it is not known, and no schedule is worked out. */
  term: string;
  person: string;
  openedOn: string;
  /**
   * Set only when the form was filled in by the loan calculator: the first payment, how interest is charged, and the
   * rate stages, which replace the one rate box. Months left still decides the length; the last stage takes the rest.
   */
  fromCalculator?: CalculatorTerms;
}

/** What the loan calculator hands Add debt beyond the boxes it fills: the agreed shape of the loan. */
export interface CalculatorTerms {
  firstPaymentOn: string;
  method: LoanMethod;
  stages: LoanCalcStage[];
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
  rateKind: 'fixed' | 'floating';
  coretaxCode: string;
  /** The calculator's later stages, written with the terms in one transaction (absent for a loan typed by hand). */
  laterPeriods?: DebtRatePeriodPlan[];
}

/** A rate change written after the terms: a later stage from the loan calculator. */
export interface DebtRatePeriodPlan {
  fromOn: string;
  rateBps: number;
  kind: 'fixed' | 'floating';
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
  /** Rate changes to write once the terms exist, in order. Empty unless the calculator gave stages. */
  laterPeriods: DebtRatePeriodPlan[];
  person: DebtPersonPlan | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The longest loan, in months, and the dearest rate, said in the period it is typed in: 100% a year, about 8,33% a month. */
export const MAX_MONTHS_TEXT = `At most ${MAX_LOAN_MONTHS} months`;
export function maxRateText(per: 'month' | 'year'): string {
  if (per === 'year') return `At most ${MAX_LOAN_RATE_BPS / 100}% a year`;
  return `At most ${(Math.floor(MAX_LOAN_RATE_BPS / 12) / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}% a month`;
}
/** What Add debt says when the calculator filled it in and the months left were cleared. */
export const CALCULATOR_NEEDS_MONTHS = 'Months left are needed for the schedule from the calculator';

/**
 * The first payment of a loan added today: today's day of the month, clamped to the 28th so every month has it, next
 * month — a debt brought in has already paid this month's instalment, or it would not be being typed in now.
 */
export function firstPaymentFor(today: string): { firstPaymentOn: string; paymentDay: number } {
  const paymentDay = Math.min(Number(today.slice(8, 10)), 28);
  return { firstPaymentOn: `${addMonths(monthOf(today), 1)}-${pad(paymentDay)}`, paymentDay };
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
  const empty: NewDebtPlan = { handOver: null, account: null, terms: null, laterPeriods: [], person: null };

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
  // A loan from the calculator is its schedule: with the months cleared there would be nothing of it left to save.
  if (draft.term.trim() === '') {
    if (draft.fromCalculator) throw new Error(CALCULATOR_NEEDS_MONTHS);
    return { ...empty, account };
  }
  const tenorMonths = Number(draft.term.trim());
  if (!Number.isInteger(tenorMonths) || tenorMonths < 1) throw new Error('A loan runs for at least one month');
  if (tenorMonths > MAX_LOAN_MONTHS) throw new Error(`${MAX_MONTHS_TEXT} left`);

  const calc = draft.fromCalculator;
  if (calc) return { ...empty, account, ...calculatorPlan(calc, tenorMonths, originalMinor, lenderName, item.code) };

  const first = firstPaymentFor(today);
  // Stored as yearly basis points whichever way it was typed; a paylater's monthly figure is that times twelve.
  // Empty is no interest, which is the 'zero' method exactly as before the rate was asked.
  const rateBps = behaviour.asksRate ? rateBpsFromTyped(draft.rate, behaviour.ratePer ?? 'year') : 0;
  if (rateBps > MAX_LOAN_RATE_BPS) throw new Error(`The rate is ${maxRateText(behaviour.ratePer ?? 'year').toLowerCase()}`);
  return {
    ...empty,
    account,
    terms: {
      lenderName,
      originalMinor,
      firstPaymentOn: first.firstPaymentOn,
      tenorMonths,
      method: rateBps > 0 ? 'annuity' : 'zero',
      paymentDay: first.paymentDay,
      rateBps,
      rateKind: 'fixed',
      coretaxCode: item.code,
    },
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calculator's loan as terms and rate changes: the first stage is the opening rate, each later stage a rate change
 * on its first payment — the periods `calculatorLoan` works the calculator's own table from, so the saved loan's
 * schedule is that table. Months left decides the length: the last stage takes whatever the stages before it leave.
 */
function calculatorPlan(calc: CalculatorTerms, tenorMonths: number, originalMinor: number, lenderName: string, coretaxCode: string): Pick<NewDebtPlan, 'terms' | 'laterPeriods'> {
  if (!DATE.test(calc.firstPaymentOn)) throw new Error('Choose the date of the first payment');
  const before = calc.stages.slice(0, -1);
  const last = calc.stages.at(-1);
  if (!last) throw new Error('A loan needs a rate');
  const used = before.reduce((total, stage) => total + stage.months, 0);
  if (used >= tenorMonths) throw new Error('The rate stages run longer than the months left');
  const paymentDay = Math.min(Number(calc.firstPaymentOn.slice(8, 10)), 28);
  const firstPaymentOn = `${calc.firstPaymentOn.slice(0, 8)}${pad(paymentDay)}`;
  const { terms, periods } = calculatorLoan({
    principalMinor: originalMinor,
    method: calc.method,
    stages: [...before, { ...last, months: tenorMonths - used }],
    firstPaymentOn,
    paymentDay,
  });
  const [opening, ...later] = periods;
  const laterPeriods = later.map((period) => ({ fromOn: period.fromOn, rateBps: period.rateBps, kind: period.kind }));
  return {
    terms: { lenderName, ...terms, rateBps: opening!.rateBps, rateKind: opening!.kind, coretaxCode, laterPeriods },
    laterPeriods,
  };
}

/**
 * What the loan calculator's Save as debt carries to Add debt, in the page's address: which debt it is, its name, what
 * is owed (as the box shows it), the months, and the agreed shape of the loan. The lender is never guessed.
 */
export interface CalculatorPrefill extends CalculatorTerms {
  item: string;
  name: string;
  owed: string;
  months: number;
}

const isStage = (value: unknown): value is LoanCalcStage => {
  if (typeof value !== 'object' || value === null) return false;
  const stage = value as Record<string, unknown>;
  return (
    Number.isInteger(stage.months) &&
    (stage.months as number) > 0 &&
    Number.isInteger(stage.rateBps) &&
    (stage.rateBps as number) >= 0 &&
    (stage.rateBps as number) <= MAX_LOAN_RATE_BPS &&
    (stage.kind === 'fixed' || stage.kind === 'floating')
  );
};
const METHODS: readonly LoanMethod[] = ['annuity', 'flat', 'zero'];

/** The prefill read back from an address, or null when anything in it is not what the calculator writes. */
export function readCalculatorPrefill(value: unknown): CalculatorPrefill | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.item !== 'string' || typeof v.name !== 'string' || typeof v.owed !== 'string') return null;
  if (!Number.isInteger(v.months) || (v.months as number) < 1 || (v.months as number) > MAX_LOAN_MONTHS) return null;
  if (typeof v.firstPaymentOn !== 'string' || !DATE.test(v.firstPaymentOn)) return null;
  if (!METHODS.includes(v.method as LoanMethod)) return null;
  if (!Array.isArray(v.stages) || v.stages.length === 0 || !v.stages.every(isStage)) return null;
  try {
    if (debtItem(v.item).behaviour.opens !== 'loan') return null;
  } catch {
    return null;
  }
  return {
    item: v.item,
    name: v.name,
    owed: v.owed,
    months: v.months as number,
    firstPaymentOn: v.firstPaymentOn,
    method: v.method as LoanMethod,
    stages: (v.stages as LoanCalcStage[]).map((stage) => ({ months: stage.months, rateBps: stage.rateBps, kind: stage.kind })),
  };
}

/** The debt form as the calculator fills it in: everything but the lender, owed as of today. */
export function draftFromCalculator(prefill: CalculatorPrefill, today: string): DebtItemDraft {
  return {
    ...emptyDebtItemDraft(prefill.item, today),
    name: prefill.name,
    owed: prefill.owed,
    term: String(prefill.months),
    fromCalculator: { firstPaymentOn: prefill.firstPaymentOn, method: prefill.method, stages: prefill.stages },
  };
}

/** A stage as Add debt lists it under Rate: its rate, how it is charged, and the months it runs, `2029-12`. */
export interface CalculatorStageSpan {
  rateBps: number;
  kind: 'fixed' | 'floating';
  fromMonth: string;
  toMonth: string;
}

/**
 * The calculator's stages over the months left as typed now: the last stage takes what the others leave, and the
 * stages that no longer fit are not listed (saving refuses them). Empty while the months left do not read.
 */
export function calculatorStageSpans(calc: CalculatorTerms, term: string): CalculatorStageSpan[] {
  const months = Number(term.trim());
  if (!Number.isInteger(months) || months < 1 || !DATE.test(calc.firstPaymentOn)) return [];
  const day = Math.min(Number(calc.firstPaymentOn.slice(8, 10)), 28);
  const spans: CalculatorStageSpan[] = [];
  let start = 0;
  calc.stages.forEach((stage, index) => {
    const last = index === calc.stages.length - 1;
    const length = last ? months - start : stage.months;
    if (length < 1 || start + length > months) return;
    spans.push({
      rateBps: stage.rateBps,
      kind: stage.kind,
      fromMonth: paymentDate(calc.firstPaymentOn, day, start).slice(0, 7),
      toMonth: paymentDate(calc.firstPaymentOn, day, start + length - 1).slice(0, 7),
    });
    start += length;
  });
  return spans;
}

/**
 * A stage's two lines under Rate: "5,5% a year, fixed" over "until November 2029"; the last floating one "from
 * December 2029 · changes recorded as they come". A rate a month is written a month.
 */
export function stageSpanText(spans: readonly CalculatorStageSpan[], index: number, method: LoanMethod, per: 'month' | 'year'): { title: string; subtitle: string } {
  const span = spans[index]!;
  const rate = method === 'zero' || span.rateBps === 0 ? 'No interest' : per === 'month' ? rateTextPer(span.rateBps, 'month') : `${rateTextPer(span.rateBps, 'year')} a year`;
  const how = method === 'zero' || span.rateBps === 0 ? '' : `, ${method === 'flat' ? 'flat' : span.kind}`;
  const only = spans.length === 1;
  const first = index === 0;
  const last = index === spans.length - 1;
  const subtitle = only
    ? `${longMonth(span.fromMonth)} to ${longMonth(span.toMonth)}`
    : first
      ? `until ${longMonth(span.toMonth)}`
      : last
        ? `from ${longMonth(span.fromMonth)}${span.kind === 'floating' ? ' · changes recorded as they come' : ''}`
        : `${longMonth(span.fromMonth)} to ${longMonth(span.toMonth)}`;
  return { title: `${rate}${how}`, subtitle };
}

/** What the card form asks for, as typed. The chosen catalogue entry is passed beside it, not held in here. */
export interface NewCardDraft {
  name: string;
  /** The bank, when the card is typed by hand — the one its name leads with. A catalogue card is told its bank by the entry. */
  issuer: string;
  last4: string;
  owed: string;
  /** The credit limit, optional, in the card's currency. */
  limit: string;
  /** The holder's standing with the bank, for an entry that publishes levels. */
  memberLevel: string;
  statementDay: string;
  dueDay: string;
}

export const emptyNewCardDraft = (): NewCardDraft => ({ name: '', issuer: '', last4: '', owed: '', limit: '', memberLevel: '', statementDay: '', dueDay: '' });

export interface NewCardPlan {
  name: string;
  issuer: string | null;
  last4: string | null;
  currency: string;
  openingBalanceMinor: number;
  /** The level to apply the entry at, when it publishes any. */
  memberLevel: string | null;
  /**
   * The billing cycle, or null when neither day was given. A card from the catalogue may leave both for later too:
   * its earn rules do not wait for them, and the card's own page asks for the days, with the published fee filled
   * in beside them, until they are saved.
   */
  terms: { statementDay: number; dueDay: number } | null;
  /** The credit limit typed, kept with or without the dates: null when none was given. */
  creditLimitMinor: number | null;
}

/**
 * The bank a hand-typed card's name already says: "Mandiri Signature" is Mandiri's, "BCA Everyday" is BCA's.
 *
 * A name is matched by its leading words, whole and in any case, against the banks the Bank row would offer — so
 * "Bcaxyz" names no bank, and of two that both lead the name ("CIMB" and "CIMB Niaga") the longer one wins, being
 * the more exact. Null when no bank leads the name: the card is then filed under none until its Settings say one.
 */
export function issuerInName(name: string, issuers: readonly string[]): string | null {
  const words = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let found: string | null = null;
  let length = 0;
  for (const issuer of issuers) {
    const bankWords = issuer.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (bankWords.length === 0 || bankWords.length <= length || bankWords.length > words.length) continue;
    if (bankWords.every((word, i) => words[i] === word)) {
      found = issuer;
      length = bankWords.length;
    }
  }
  return found;
}

/**
 * A name typed for a card the catalogue does not carry, as the bank-and-name row shows it: the bank its leading
 * words name, and the rest as the card's own name — "Mandiri Signature" is Mandiri, Signature. A name that is the
 * bank and nothing more keeps itself whole, since a card is never left without a name; no bank leaves it whole too.
 */
export function splitCardName(typed: string, issuers: readonly string[]): { bank: string; name: string } {
  const whole = typed.trim().replace(/\s+/g, ' ');
  const bank = issuerInName(whole, issuers);
  if (!bank) return { bank: '', name: whole };
  const rest = whole.split(' ').slice(bank.trim().split(/\s+/).length).join(' ');
  return { bank, name: rest || whole };
}

/**
 * The account name a bank-and-name row saves: the two read together, "Mandiri" and "Signature" as "Mandiri
 * Signature" — the name the card was searched for, and the one every list shows. A name that already starts with
 * its bank is not given it twice, and no bank leaves the name as typed.
 */
export function cardAccountName(bank: string, name: string): string {
  const b = bank.trim();
  const n = name.trim();
  if (!b || !n) return n;
  const lower = n.toLowerCase();
  const lead = b.toLowerCase();
  return lower === lead || lower.startsWith(`${lead} `) ? n : `${b} ${n}`;
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
export function planNewCard(draft: NewCardDraft, entry: CatalogEntry | null, baseCurrency: string, typedCurrency = baseCurrency): NewCardPlan {
  const name = draft.name.trim();
  if (!name) throw new Error('Give the card a name');

  const levels = entry ? memberLevelsOf(entry) : [];
  const memberLevel = draft.memberLevel.trim();
  // The same condition `applyCatalogEntry` enforces, asked before the account exists rather than after.
  if (levels.length > 0 && !levels.some((level) => level.key === memberLevel)) {
    throw new Error(`This card earns by ${entry?.program.name} level. Choose the level before adding it.`);
  }

  // The catalogue knows which currency the card is issued in; a card typed by hand is told it.
  const currency = entry?.currency ?? typedCurrency;
  let openingBalanceMinor = 0;
  if (draft.owed.trim() !== '') {
    try {
      openingBalanceMinor = parseMajor(draft.owed, currency);
    } catch {
      throw new Error('The amount must be a number');
    }
  }

  let creditLimitMinor: number | null = null;
  if (draft.limit.trim() !== '') {
    try {
      creditLimitMinor = parseMajor(draft.limit, currency);
    } catch {
      throw new Error('The credit limit must be a number');
    }
    if (creditLimitMinor <= 0) throw new Error('The credit limit must be more than zero');
  }

  /*
   * Both days or neither: the terms are what a cycle is counted from, and half of them counts nothing. Neither is
   * fine for any card — it opens without terms, and its page asks for them. Some issuers close every cardholder's
   * statement on the same day, so for those cards a due date alone is enough: the billing date is the issuer's.
   */
  const fixedDay = entry?.program.fixedStatementDay;
  const statementDay = draft.statementDay.trim() || (fixedDay && draft.dueDay.trim() !== '' ? String(fixedDay) : '');
  const someDay = statementDay !== '' || draft.dueDay.trim() !== '';
  if (someDay && (statementDay === '' || draft.dueDay.trim() === '')) throw new Error('Give both the billing date and the due date, or leave both for later');
  const terms = someDay ? { statementDay: dayOfMonth(statementDay, 'billing date'), dueDay: dayOfMonth(draft.dueDay, 'due date') } : null;

  return {
    name,
    issuer: entry ? entry.bank : draft.issuer.trim() || null,
    last4: draft.last4.trim() || null,
    currency,
    openingBalanceMinor,
    memberLevel: memberLevel || null,
    terms,
    creditLimitMinor,
  };
}
