import { type LoanCalcInput, type LoanCalcStage, type LoanMethod } from '@expanses/core';
import { firstPaymentFor } from '../ownables/debt-form';
import { type Field, readMoney, readPercent, readWhole } from './fields';

/**
 * The loan calculator's boxes, as typed, and what they read as.
 *
 * One calculator with four kinds, each asking the way that loan is really quoted: a home by its price, down payment,
 * years and rate stages; a vehicle by its price, down payment, months and a flat rate a year; an online loan or
 * paylater by its amount, months, a rate a month and a fee taken at the start; anything else by its amount, months, a
 * rate a year that is flat or on what is owed, and any fee. Each kind keeps its own boxes, so switching kinds and back
 * loses nothing.
 */
export type LoanKind = 'home' | 'vehicle' | 'online' | 'other';

export const LOAN_KINDS: readonly LoanKind[] = ['home', 'vehicle', 'online', 'other'];

/** One rate stage as typed. The last stage runs for whatever years are left, so its own years are never asked. */
export interface StageDraft {
  kind: 'fixed' | 'floating';
  years: string;
  /** A percentage a year. */
  rate: string;
}

/** A cost paid at the start beside the loan: an appraisal, a notary, insurance. */
export interface CostDraft {
  name: string;
  amount: string;
}

/** One shape for every kind; a kind reads only the boxes it shows. */
export interface LoanKindDraft {
  price: string;
  down: string;
  downAs: 'percent' | 'amount';
  /** The loan itself: typed for an online loan or any other, and for a home or vehicle when no price is given. */
  amount: string;
  years: string;
  months: string;
  /** The one rate of a vehicle (a year, flat), an online loan (a month) and any other loan (a year). */
  rate: string;
  /** Any other loan: flat, or charged on what is still owed. */
  flat: boolean;
  stages: StageDraft[];
  fee: string;
  feeAs: 'percent' | 'amount';
  costs: CostDraft[];
  income: string;
}

export interface LoanCalcDraft {
  kind: LoanKind;
  drafts: Record<LoanKind, LoanKindDraft>;
}

const blank: LoanKindDraft = {
  price: '',
  down: '',
  downAs: 'percent',
  amount: '',
  years: '',
  months: '',
  rate: '',
  flat: false,
  stages: [],
  fee: '',
  feeAs: 'percent',
  costs: [],
  income: '',
};

/** A home loan opens on the shape it is usually sold in: a fixed stage, then floating. Every box is empty. */
export function emptyLoanKindDraft(kind: LoanKind): LoanKindDraft {
  if (kind === 'home') {
    return {
      ...blank,
      stages: [
        { kind: 'fixed', years: '', rate: '' },
        { kind: 'floating', years: '', rate: '' },
      ],
    };
  }
  return { ...blank, flat: kind === 'vehicle' || kind === 'online' };
}

export const emptyLoanCalcDraft = (): LoanCalcDraft => ({
  kind: 'home',
  drafts: { home: emptyLoanKindDraft('home'), vehicle: emptyLoanKindDraft('vehicle'), online: emptyLoanKindDraft('online'), other: emptyLoanKindDraft('other') },
});

const text = (value: unknown, otherwise = ''): string => (typeof value === 'string' ? value : otherwise);

/** What was kept, read back defensively: anything missing or of the wrong shape is the empty box. */
export function loanCalcDraftFrom(saved: Record<string, unknown> | null | undefined): LoanCalcDraft {
  const draft = emptyLoanCalcDraft();
  if (!saved) return draft;
  if (LOAN_KINDS.includes(saved.kind as LoanKind)) draft.kind = saved.kind as LoanKind;
  const drafts = typeof saved.drafts === 'object' && saved.drafts !== null ? (saved.drafts as Record<string, unknown>) : {};
  for (const kind of LOAN_KINDS) {
    const kept = drafts[kind];
    if (typeof kept !== 'object' || kept === null) continue;
    const k = kept as Record<string, unknown>;
    const base = emptyLoanKindDraft(kind);
    const stages = Array.isArray(k.stages)
      ? k.stages
          .filter((stage): stage is Record<string, unknown> => typeof stage === 'object' && stage !== null)
          .map((stage) => ({ kind: stage.kind === 'floating' ? ('floating' as const) : ('fixed' as const), years: text(stage.years), rate: text(stage.rate) }))
      : base.stages;
    const costs = Array.isArray(k.costs)
      ? k.costs.filter((cost): cost is Record<string, unknown> => typeof cost === 'object' && cost !== null).map((cost) => ({ name: text(cost.name), amount: text(cost.amount) }))
      : [];
    draft.drafts[kind] = {
      price: text(k.price),
      down: text(k.down),
      downAs: k.downAs === 'amount' ? 'amount' : 'percent',
      amount: text(k.amount),
      years: text(k.years),
      months: text(k.months),
      rate: text(k.rate),
      flat: typeof k.flat === 'boolean' ? k.flat : base.flat,
      stages: kind === 'home' && stages.length === 0 ? base.stages : stages,
      fee: text(k.fee),
      feeAs: k.feeAs === 'amount' ? 'amount' : 'percent',
      costs,
      income: text(k.income),
    };
  }
  return draft;
}

/** The figures beside the loan that the result page reads: what was paid down, the fee, the costs, the income. */
export interface LoanFacts {
  priceMinor: number;
  downMinor: number;
  loanMinor: number;
  /** Taken at the start from the money that arrives (an online loan's, any other's). */
  feeMinor: number;
  /** Paid at the start beside the loan (a home's, a vehicle's). */
  costsMinor: number;
  incomeMinor: number;
}

export interface LoanWorking {
  /** A box that does not read, by its key: `price`, `stage1.rate`. Said on its own row. */
  problems: Record<string, string>;
  input: LoanCalcInput | null;
  facts: LoanFacts | null;
  /** The loan as far as it reads, for the Loan row while the rest is still being typed. */
  loanMinor: number | null;
}

/** Whether a kind's length is asked in years (a home) or in months. */
export const lengthInYears = (kind: LoanKind) => kind === 'home';
/** A price and a down payment: a home and a vehicle. */
export const asksPrice = (kind: LoanKind) => kind === 'home' || kind === 'vehicle';
/** A fee taken at the start: an online loan and any other. */
export const asksFee = (kind: LoanKind) => kind === 'online' || kind === 'other';
/** The period the single rate is typed in. */
export const ratePerOf = (kind: LoanKind): 'month' | 'year' => (kind === 'online' ? 'month' : 'year');

const BPS = 10_000;

/** A rate typed as a percentage, in yearly basis points: a rate a month is stored ×12, the loan form's own convention. */
function readRate(typed: string, per: 'month' | 'year'): Field<number> {
  const read = readPercent(typed);
  if (!read.ok) return { ok: false, problem: 'Type a percentage' };
  if (read.value < 0) return { ok: false, problem: 'Not below nothing' };
  return { ok: true, value: per === 'month' ? read.value * 12 : read.value };
}

/** A share of `of` typed as a percentage, or an amount, in minor units. */
function readShare(typed: string, as: 'percent' | 'amount', ofMinor: number, currency: string): Field<number> {
  if (as === 'amount') return readMoney(typed, currency);
  if (typed.trim() === '') return { ok: true, value: 0 };
  const read = readPercent(typed);
  if (!read.ok) return { ok: false, problem: 'Type a percentage' };
  if (read.value < 0) return { ok: false, problem: 'Not below nothing' };
  return { ok: true, value: Math.round((ofMinor * read.value) / BPS) };
}

/**
 * Reads a kind's boxes, never throwing. An empty box the loan needs makes no problem — the result simply waits —
 * while a box typed in a way that does not read says so on its own row.
 */
export function loanWorking(kind: LoanKind, draft: LoanKindDraft, currency: string, today: string): LoanWorking {
  const problems: Record<string, string> = {};
  let missing = false;
  const read = <T>(key: string, field: Field<T>, typed: string): T | null => {
    if (typed.trim() === '') {
      missing = true;
      return null;
    }
    if (field.ok) return field.value;
    problems[key] = field.problem;
    return null;
  };
  const optional = <T>(key: string, field: Field<T>): T | null => {
    if (field.ok) return field.value;
    problems[key] = field.problem;
    return null;
  };

  // The loan: a price less its down payment, or the amount typed.
  let priceMinor = 0;
  let downMinor = 0;
  let loanMinor: number | null = null;
  if (asksPrice(kind) && draft.price.trim() !== '') {
    priceMinor = optional('price', readMoney(draft.price, currency)) ?? 0;
    downMinor = optional('down', readShare(draft.down, draft.downAs, priceMinor, currency)) ?? 0;
    if (priceMinor > 0 && downMinor >= priceMinor) problems.down = 'Less than the price';
    loanMinor = priceMinor - downMinor;
  } else {
    loanMinor = read('amount', readMoney(draft.amount, currency), draft.amount);
  }
  if (loanMinor === 0) missing = true;

  // How long: whole years for a home, months for the rest.
  let months: number | null;
  if (lengthInYears(kind)) {
    const years = read('years', readWhole(draft.years), draft.years);
    if (years === 0) problems.years = 'At least one year';
    months = years === null ? null : years * 12;
  } else {
    months = read('months', readWhole(draft.months), draft.months);
    if (months === 0) problems.months = 'At least one month';
  }

  // The rate: stages for a home, one rate for the rest.
  const stages: LoanCalcStage[] = [];
  if (kind === 'home') {
    let used = 0;
    draft.stages.forEach((stage, index) => {
      const key = `stage${index + 1}`;
      const rateBps = read(`${key}.rate`, readRate(stage.rate, 'year'), stage.rate);
      const last = index === draft.stages.length - 1;
      let stageMonths: number | null = null;
      if (!last) {
        const years = read(`${key}.years`, readWhole(stage.years), stage.years);
        if (years === 0) problems[`${key}.years`] = 'At least one year';
        stageMonths = years === null ? null : years * 12;
        if (stageMonths !== null) used += stageMonths;
      } else if (months !== null) {
        stageMonths = months - used;
        if (stageMonths < 1 && draft.stages.length > 1) problems[`${key}.years`] = 'The stages before it fill the whole loan';
      }
      if (rateBps !== null && stageMonths !== null && stageMonths > 0) stages.push({ months: stageMonths, rateBps, kind: stage.kind });
    });
    if (draft.stages.length === 0) missing = true;
  } else {
    const rateBps = read('rate', readRate(draft.rate, ratePerOf(kind)), draft.rate);
    if (rateBps !== null && months !== null && months > 0) stages.push({ months, rateBps, kind: 'fixed' });
  }

  const feeMinor = asksFee(kind) && loanMinor ? (optional('fee', readShare(draft.fee, draft.feeAs, loanMinor, currency)) ?? 0) : 0;
  if (loanMinor && feeMinor >= loanMinor) problems.fee = 'Less than the loan';
  let costsMinor = 0;
  if (asksPrice(kind)) {
    draft.costs.forEach((cost, index) => {
      costsMinor += optional(`cost${index + 1}`, readMoney(cost.amount, currency)) ?? 0;
    });
  }
  const incomeMinor = optional('income', readMoney(draft.income, currency)) ?? 0;

  const none: LoanWorking = { problems, input: null, facts: null, loanMinor: loanMinor && loanMinor > 0 && !problems.down && !problems.price ? loanMinor : null };
  if (missing || Object.keys(problems).length > 0 || loanMinor === null || months === null || stages.length === 0) return none;
  if (stages.reduce((total, stage) => total + stage.months, 0) !== months) return none;

  const anyInterest = stages.some((stage) => stage.rateBps > 0);
  const flat = kind === 'vehicle' || kind === 'online' || (kind === 'other' && draft.flat);
  const method: LoanMethod = !anyInterest ? 'zero' : flat ? 'flat' : 'annuity';
  const first = firstPaymentFor(today);
  return {
    problems,
    input: { principalMinor: loanMinor, method, stages, firstPaymentOn: first.firstPaymentOn, paymentDay: first.paymentDay },
    facts: { priceMinor, downMinor, loanMinor, feeMinor, costsMinor, incomeMinor },
    loanMinor,
  };
}
