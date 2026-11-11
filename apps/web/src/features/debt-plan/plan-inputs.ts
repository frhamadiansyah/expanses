import {
  convertMinor,
  daysFrom,
  installmentSchedule,
  installmentSplit,
  loanRatePer,
  monthOf,
  type PayoffDebt,
  payoffDebtFromSchedule,
  periodOn,
} from '@expanses/core';
import type { CardInstallmentRow, DebtMovement, LoanPlanFact, LoanTermsRow, PeopleDebts, PersonDebtRow } from '@expanses/db';
import { type CardFacts, type DebtAccount, type DebtRow, dayMonth, groupDebts } from '../networth/debt-rows';
import { cardPay, loanPay, type PayTarget, personPay } from './pay-target';

/**
 * Every debt the plan counts, read off the Liabilities page's own reading (`groupDebts`) and never beside it: the
 * figures it shows, each debt's next payment, and what the payoff engine is handed for it. Pure, so a test can hold
 * each rule of spec §5–§7.1 down without a database.
 */

export type PlanItemKind = 'loan' | 'card' | 'person' | 'bill';

export interface PlanItem {
  /** `${kind}:${id}:${dueOn}`. */
  key: string;
  /** Null for a bill. */
  debtKey: string | null;
  kind: PlanItemKind;
  /** The debt's (or the bill's) own name: "Kredit". */
  name: string;
  /** "Kredit · 4/6", "BCA Visa", "Electricity", "Dewi". */
  title: string;
  /** "Statement · 18 Nov", "Bill · 20 Nov", "Lend & borrow · 3 Dec", "Oct instalment". */
  detail: string;
  dueOn: string;
  status: 'paid' | 'late' | 'upcoming';
  daysLate: number;
  /** Its own currency; what was paid when paid. */
  minor: number | null;
  currency: string;
  baseMinor: number | null;
  approximate: boolean;
  paidOn: string | null;
  fromMessage: boolean;
  pay: PayTarget | null;
}

export type PlanDebtKind = 'loan' | 'card' | 'person' | 'payable';

export interface PlanDebt {
  /** DebtRow.key. */
  key: string;
  kind: PlanDebtKind;
  accountId: string | null;
  personName: string | null;
  name: string;
  currency: string;
  /** Own currency; borrowed = left + repaid always. */
  leftMinor: number;
  borrowedMinor: number;
  repaidMinor: number;
  leftBase: number | null;
  borrowedBase: number | null;
  repaidBase: number | null;
  /** The currency with no rate, when there is one. */
  missing: string | null;
  /** Yearly bps; null when unknown (a loan with no terms). */
  rateBps: number | null;
  ratePer: 'month' | 'year';
  hasTerms: boolean;
  /** The tenor, for "4/6". */
  instalmentOf: number | null;
  /** Its own schedule's last month. */
  endsMonth: string | null;
  next: PlanItem | null;
  late: boolean;
  daysLate: number;
  paidOff: boolean;
  paidOffMonth: string | null;
  /** Null when paid off or when its currency has no rate. */
  payoff: PayoffDebt | null;
}

export interface PlanReadings {
  accounts: readonly DebtAccount[];
  balances: Readonly<Record<string, number>>;
  loans: readonly LoanTermsRow[];
  items: Readonly<Record<string, string>>;
  loanFacts: readonly LoanPlanFact[];
  cards: Readonly<Record<string, CardFacts>>;
  cardPlans: readonly CardInstallmentRow[];
  people: PeopleDebts;
  movements: readonly DebtMovement[];
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthsBetween = (from: string, to: string): number =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/** An instalment's number, counted from the loan's first. */
export const instalmentNumber = (terms: Pick<LoanTermsRow, 'firstPaymentOn'>, dueOn: string) => monthsBetween(terms.firstPaymentOn.slice(0, 7), dueOn.slice(0, 7)) + 1;

/** "Kredit · 4/6". */
export const instalmentTitle = (name: string, number: number, tenor: number) => `${name} · ${number}/${tenor}`;

/** "Oct instalment" for one of an earlier month than `today`'s, else "Instalment · 1 Nov". */
export const instalmentDetail = (dueOn: string, today: string) =>
  monthOf(dueOn) < monthOf(today) ? `${MONTHS[Number(dueOn.slice(5, 7)) - 1]} instalment` : `Instalment · ${dayMonth(dueOn)}`;

/** Spec §6.2: an unpaid instalment's figure — the schedule row in its month, else the first row's, else the period's named payment. */
export function expectedInstalment(fact: Pick<LoanPlanFact, 'schedule'>, terms: Pick<LoanTermsRow, 'periods'>, dueOn: string, today: string): number | null {
  const figure = fact.schedule.find((r) => monthOf(r.onDate) === monthOf(dueOn))?.paymentMinor ?? fact.schedule[0]?.paymentMinor ?? periodOn(terms.periods, today)?.paymentMinor ?? null;
  return figure || null;
}

/** A figure in the base currency at the held rate, or null with no rate (nothing is still nothing). */
function toBase(minor: number, currency: string, readings: PlanReadings): number | null {
  if (currency === readings.baseCurrency) return minor;
  const rate = readings.ratesToBase[currency];
  if (rate === undefined || !(rate > 0)) return minor === 0 ? 0 : null;
  return convertMinor(minor, currency, readings.baseCurrency, rate);
}

const hasRate = (currency: string, readings: PlanReadings): boolean => currency === readings.baseCurrency || (readings.ratesToBase[currency] ?? 0) > 0;

/** Borrowed and repaid around what is left: when more is owed than was borrowed, borrowed is read as what is left. */
function shares(leftMinor: number, borrowed: number): { borrowedMinor: number; repaidMinor: number } {
  const borrowedMinor = Math.max(borrowed, leftMinor);
  return { borrowedMinor, repaidMinor: borrowedMinor - leftMinor };
}

function item(debt: Pick<PlanDebt, 'key' | 'currency' | 'name'>, kind: PlanItemKind, id: string, parts: Pick<PlanItem, 'title' | 'detail' | 'dueOn' | 'status' | 'daysLate' | 'minor' | 'pay'>, readings: PlanReadings): PlanItem {
  return {
    key: `${kind}:${id}:${parts.dueOn}`,
    debtKey: debt.key,
    kind,
    name: debt.name,
    ...parts,
    currency: debt.currency,
    baseMinor: parts.minor === null ? null : toBase(parts.minor, debt.currency, readings),
    approximate: debt.currency !== readings.baseCurrency,
    paidOn: null,
    fromMessage: false,
  };
}

/** The engine's input in the base currency: every figure converted at the held rate. */
function payoffInBase(debt: PayoffDebt, currency: string, readings: PlanReadings): PayoffDebt {
  if (currency === readings.baseCurrency) return debt;
  const convert = (minor: number) => toBase(minor, currency, readings) ?? 0;
  return {
    ...debt,
    balanceMinor: convert(debt.balanceMinor),
    minimumsMinor: debt.minimumsMinor.map(convert),
    regularMinor: convert(debt.regularMinor),
    interest: debt.interest.kind === 'fixed' ? { kind: 'fixed', minor: convert(debt.interest.minor) } : debt.interest,
  };
}

const increasesOn = (accountId: string, movements: readonly DebtMovement[]) =>
  movements.filter((m) => m.accountId === accountId && m.amountMinor < 0).reduce((sum, m) => sum - m.amountMinor, 0);

function loanDebt(row: DebtRow, readings: PlanReadings, today: string): PlanDebt {
  const accountId = row.accountId!;
  const terms = readings.loans.find((loan) => loan.accountId === accountId);
  const fact = readings.loanFacts.find((f) => f.accountId === accountId);
  const leftMinor = row.minor;
  const { borrowedMinor, repaidMinor } = shares(leftMinor, terms ? terms.originalMinor : increasesOn(accountId, readings.movements));
  const schedule = fact?.schedule ?? [];
  const rateBps = terms ? (periodOn(terms.periods, schedule[0]?.onDate ?? today)?.rateBps ?? 0) : null;
  const late = (fact?.instalments ?? []).filter((i) => i.status === 'late');
  const daysLate = late.reduce((max, i) => Math.max(max, i.daysLate), 0);
  const base = {
    key: row.key,
    kind: 'loan' as const,
    accountId,
    personName: null,
    name: row.name,
    currency: row.currency,
    leftMinor,
    borrowedMinor,
    repaidMinor,
    leftBase: toBase(leftMinor, row.currency, readings),
    borrowedBase: toBase(borrowedMinor, row.currency, readings),
    repaidBase: toBase(repaidMinor, row.currency, readings),
    missing: hasRate(row.currency, readings) ? null : row.currency,
    rateBps,
    ratePer: loanRatePer(readings.items[accountId]),
    hasTerms: terms !== undefined,
    instalmentOf: terms?.tenorMonths ?? null,
    endsMonth: schedule.at(-1)?.onDate.slice(0, 7) ?? null,
    late: late.length > 0,
    daysLate,
    paidOff: false,
    paidOffMonth: null,
  };

  let next: PlanItem | null = null;
  if (terms && fact) {
    const numberOn = (dueOn: string) => fact.instalments.find((i) => i.dueOn === dueOn)?.number ?? instalmentNumber(terms, dueOn);
    const title = (n: number) => instalmentTitle(row.name, n, terms.tenorMonths);
    const detailOf = (dueOn: string) => instalmentDetail(dueOn, today);
    const oldest = late[0];
    if (oldest) {
      const expected = expectedInstalment(fact, terms, oldest.dueOn, today);
      next = item(base, 'loan', accountId, { title: title(oldest.number), detail: detailOf(oldest.dueOn), dueOn: oldest.dueOn, status: 'late', daysLate: oldest.daysLate, minor: expected, pay: loanPay(accountId) }, readings);
    } else if (schedule[0]) {
      const first = schedule[0];
      next = item(base, 'loan', accountId, { title: title(numberOn(first.onDate)), detail: detailOf(first.onDate), dueOn: first.onDate, status: 'upcoming', daysLate: 0, minor: first.paymentMinor, pay: loanPay(accountId) }, readings);
    }
  }

  let payoff: PayoffDebt | null = null;
  if (base.missing === null && leftMinor > 0) {
    payoff = terms
      ? payoffInBase(
          payoffDebtFromSchedule({ key: row.key, name: row.name, balanceMinor: leftMinor, rows: schedule, method: terms.method, periods: terms.periods, startMonth: monthOf(today), late: base.late, daysLate }),
          row.currency,
          readings,
        )
      : { key: row.key, name: row.name, balanceMinor: base.leftBase ?? 0, ratesBps: null, interest: { kind: 'none' }, minimumsMinor: [], regularMinor: 0, late: false, daysLate: 0 };
  }
  return { ...base, next, payoff };
}

function cardDebt(row: DebtRow, readings: PlanReadings, today: string): PlanDebt {
  const accountId = row.accountId!;
  const facts = readings.cards[accountId];
  const leftMinor = row.minor;
  // Spec §5.3: repaid is what was paid toward the last statement since it closed.
  const repaid = facts && facts.billedMinor > 0 ? Math.max(0, facts.billedMinor - facts.leftToPayMinor) : 0;
  const borrowedMinor = leftMinor + repaid;
  const dueOn = facts?.dueOn ?? null;
  const owing = (facts?.leftToPayMinor ?? 0) > 0;
  const late = dueOn !== null && owing && dueOn < today;
  const daysLate = late ? daysFrom(dueOn!, today) : 0;
  const base = {
    key: row.key,
    kind: 'card' as const,
    accountId,
    personName: null,
    name: row.name,
    currency: row.currency,
    leftMinor,
    borrowedMinor,
    repaidMinor: repaid,
    leftBase: toBase(leftMinor, row.currency, readings),
    borrowedBase: toBase(borrowedMinor, row.currency, readings),
    repaidBase: toBase(repaid, row.currency, readings),
    missing: hasRate(row.currency, readings) ? null : row.currency,
    rateBps: 0,
    ratePer: 'year' as const,
    hasTerms: facts?.hasTerms ?? false,
    instalmentOf: null,
    endsMonth: null,
    late,
    daysLate,
    paidOff: false,
    paidOffMonth: null,
  };
  const next =
    dueOn !== null && owing
      ? item(base, 'card', accountId, { title: row.name, detail: `Statement · ${dayMonth(dueOn)}`, dueOn, status: late ? 'late' : 'upcoming', daysLate, minor: facts!.leftToPayMinor, pay: cardPay(accountId) }, readings)
      : null;

  let payoff: PayoffDebt | null = null;
  if (base.missing === null) {
    const startMonth = monthOf(today);
    const plans = readings.cardPlans.filter((plan) => plan.cardAccountId === accountId);
    const running = plans.filter((plan) => installmentSplit(plan, today).unbilledMinor > 0);
    // A card with no billing date: the whole balance is this month's. Otherwise this month is what is left less the
    // plans' instalments still to bill, and each later month the instalments billed in it. New spending is not modelled.
    const minimums: number[] = [Math.max(0, leftMinor - (facts?.hasTerms ? running.reduce((sum, plan) => sum + installmentSplit(plan, today).unbilledMinor, 0) : 0))];
    if (facts?.hasTerms) {
      for (const plan of running) {
        // Only the month a statement closes in is read, so the statement day itself does not matter here.
        for (const billing of installmentSchedule(plan, 1)) {
          const index = monthsBetween(startMonth, billing.statementOn.slice(0, 7));
          if (index < 1) continue;
          while (minimums.length <= index) minimums.push(0);
          minimums[index]! += billing.amountMinor;
        }
      }
    }
    payoff = payoffInBase(
      {
        key: row.key,
        name: row.name,
        balanceMinor: leftMinor,
        ratesBps: [0],
        interest: { kind: 'none' },
        minimumsMinor: minimums,
        regularMinor: facts?.hasTerms ? running.reduce((sum, plan) => sum + plan.monthlyMinor, 0) : 0,
        late,
        daysLate,
      },
      row.currency,
      readings,
    );
  }
  return { ...base, next, payoff };
}

/** A person's open loan that a repayment goes to: the one due soonest, else the first. */
const openLoans = (person: PersonDebtRow) => person.loans.filter((loan) => loan.status === 'open');

function personDebt(row: DebtRow, readings: PlanReadings, today: string): PlanDebt {
  const person = readings.people.youOwe.find((p) => p.personName === row.personName && p.currency === row.currency);
  const leftMinor = row.minor;
  const loans = person ? openLoans(person) : [];
  const { borrowedMinor, repaidMinor } = shares(leftMinor, (person?.loans ?? []).reduce((sum, loan) => sum + loan.originalMinor, 0));
  const dated = loans.filter((loan) => loan.dueOn !== null).sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
  const dueOn = dated[0]?.dueOn ?? null;
  const overdue = loans.filter((loan) => loan.dueState === 'overdue' && loan.dueOn !== null);
  const late = overdue.length > 0;
  const daysLate = overdue.reduce((max, loan) => Math.max(max, daysFrom(loan.dueOn!, today)), 0);
  const target = dated[0] ?? loans[0];
  const base = {
    key: row.key,
    kind: 'person' as const,
    accountId: null,
    personName: row.personName,
    name: row.name,
    currency: row.currency,
    leftMinor,
    borrowedMinor,
    repaidMinor,
    leftBase: toBase(leftMinor, row.currency, readings),
    borrowedBase: toBase(borrowedMinor, row.currency, readings),
    repaidBase: toBase(repaidMinor, row.currency, readings),
    missing: hasRate(row.currency, readings) ? null : row.currency,
    rateBps: 0,
    ratePer: 'year' as const,
    hasTerms: true,
    instalmentOf: null,
    endsMonth: null,
    late,
    daysLate,
    paidOff: false,
    paidOffMonth: null,
  };
  const next =
    dueOn !== null
      ? item(base, 'person', row.key, { title: row.name, detail: `Lend & borrow · ${dayMonth(dueOn)}`, dueOn, status: late ? 'late' : 'upcoming', daysLate, minor: leftMinor, pay: target ? personPay(target.accountId) : null }, readings)
      : null;
  // Spec §5.4: due whole in the month of its due date (a past one is this month); with no date, no minimum at all.
  const minimums: number[] = [];
  if (dueOn !== null) {
    const index = Math.max(0, monthsBetween(monthOf(today), monthOf(dueOn)));
    for (let i = 0; i < index; i += 1) minimums.push(0);
    minimums.push(leftMinor);
  }
  const payoff =
    base.missing === null
      ? payoffInBase({ key: row.key, name: row.name, balanceMinor: leftMinor, ratesBps: [0], interest: { kind: 'none' }, minimumsMinor: minimums, regularMinor: 0, late, daysLate }, row.currency, readings)
      : null;
  return { ...base, next, payoff };
}

function payableDebt(row: DebtRow, readings: PlanReadings): PlanDebt {
  const accountId = row.accountId!;
  const leftMinor = row.minor;
  const { borrowedMinor, repaidMinor } = shares(leftMinor, increasesOn(accountId, readings.movements));
  const missing = hasRate(row.currency, readings) ? null : row.currency;
  return {
    key: row.key,
    kind: 'payable',
    accountId,
    personName: null,
    name: row.name,
    currency: row.currency,
    leftMinor,
    borrowedMinor,
    repaidMinor,
    leftBase: toBase(leftMinor, row.currency, readings),
    borrowedBase: toBase(borrowedMinor, row.currency, readings),
    repaidBase: toBase(repaidMinor, row.currency, readings),
    missing,
    rateBps: 0,
    ratePer: 'year',
    hasTerms: false,
    instalmentOf: null,
    endsMonth: null,
    next: null,
    late: false,
    daysLate: 0,
    paidOff: false,
    paidOffMonth: null,
    payoff: missing === null ? payoffInBase({ key: row.key, name: row.name, balanceMinor: leftMinor, ratesBps: [0], interest: { kind: 'none' }, minimumsMinor: [], regularMinor: 0, late: false, daysLate: 0 }, row.currency, readings) : null,
  };
}

function paidOffDebt(parts: Pick<PlanDebt, 'key' | 'kind' | 'accountId' | 'personName' | 'name' | 'currency' | 'paidOffMonth'> & { borrowed: number }, readings: PlanReadings): PlanDebt {
  const borrowedBase = toBase(parts.borrowed, parts.currency, readings);
  return {
    key: parts.key,
    kind: parts.kind,
    accountId: parts.accountId,
    personName: parts.personName,
    name: parts.name,
    currency: parts.currency,
    leftMinor: 0,
    borrowedMinor: parts.borrowed,
    repaidMinor: parts.borrowed,
    leftBase: 0,
    borrowedBase,
    repaidBase: borrowedBase,
    missing: hasRate(parts.currency, readings) ? null : parts.currency,
    rateBps: null,
    ratePer: 'year',
    hasTerms: parts.kind === 'loan',
    instalmentOf: null,
    endsMonth: null,
    next: null,
    late: false,
    daysLate: 0,
    paidOff: true,
    paidOffMonth: parts.paidOffMonth,
    payoff: null,
  };
}

/** Every debt in the plan, active then paid off (spec §5). Built on `groupDebts`, never beside it. */
export function planDebts(readings: PlanReadings, today: string): PlanDebt[] {
  const sheet = groupDebts(
    {
      accounts: readings.accounts,
      balances: readings.balances,
      loans: readings.loans,
      cards: readings.cards,
      people: readings.people.youOwe,
      sheet: null,
      baseCurrency: readings.baseCurrency,
      ratesToBase: readings.ratesToBase,
      items: readings.items,
    },
    today,
  );
  const active: PlanDebt[] = [];
  for (const row of sheet.groups.flatMap((group) => group.rows)) {
    if (row.kind === 'loan') active.push(loanDebt(row, readings, today));
    // A card owing nothing is left out, not paid off: it revolves.
    else if (row.kind === 'card') {
      if (row.minor > 0) active.push(cardDebt(row, readings, today));
    } else if (row.personName !== null) active.push(personDebt(row, readings, today));
    else active.push(payableDebt(row, readings));
  }

  const byId = new Map(readings.accounts.map((a) => [a.id, a]));
  const paidOff: PlanDebt[] = sheet.cleared.map((cleared) => {
    const terms = readings.loans.find((loan) => loan.accountId === cleared.accountId);
    const currency = byId.get(cleared.accountId)?.currency ?? readings.baseCurrency;
    return paidOffDebt(
      { key: cleared.accountId, kind: 'loan', accountId: cleared.accountId, personName: null, name: cleared.name, currency, paidOffMonth: cleared.clearedOn?.slice(0, 7) ?? null, borrowed: terms?.originalMinor ?? increasesOn(cleared.accountId, readings.movements) },
      readings,
    );
  });
  for (const person of readings.people.settled.filter((p) => p.direction === 'borrowed')) {
    const ids = new Set(person.loans.map((loan) => loan.accountId));
    const last = readings.movements.filter((m) => ids.has(m.accountId)).map((m) => m.occurredOn).sort().at(-1);
    paidOff.push(
      paidOffDebt(
        { key: `person:${person.personName}:${person.currency}`, kind: 'person', accountId: null, personName: person.personName, name: person.personName, currency: person.currency, paidOffMonth: last?.slice(0, 7) ?? null, borrowed: person.loans.reduce((sum, loan) => sum + loan.originalMinor, 0) },
        readings,
      ),
    );
  }
  return [...active, ...paidOff];
}
