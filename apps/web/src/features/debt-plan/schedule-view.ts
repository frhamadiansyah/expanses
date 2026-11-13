import { BILL_DUE_SOON_DAYS, convertMinor, daysFrom, monthOf } from '@expanses/core';
import type { BillMonthRow, CardStatement, LoanPlanFact } from '@expanses/db';
import { dayMonth } from '../networth/debt-rows';
import { billPay, cardPay, loanPay } from './pay-target';
import { expectedInstalment, instalmentDetail, instalmentNumber, instalmentTitle, type PlanDebt, type PlanItem } from './plan-inputs';

/**
 * The plan's month (spec §4.2, §6.4, §6.9, §4.6): every loan instalment, card statement and recurring bill due in one
 * month, where each stands, and the month's Due / Paid / Late. The Schedule, the Report's bars and the Cashflow row
 * all read it. Pure.
 */

export interface CardMonth {
  cardId: string;
  name: string;
  currency: string;
  dueOn: string;
  statement: CardStatement;
}

export interface MonthInput {
  month: string;
  today: string;
  debts: readonly PlanDebt[];
  loanFacts: readonly LoanPlanFact[];
  cards: readonly CardMonth[];
  /**
   * The open book's bills owed in this month and the one before (a bill out late in a month is paid by a day in the
   * next), each with the currency it is written in. Only those whose pay-by day is in the month are its items.
   */
  bills: readonly { row: BillMonthRow; currency: string; /** What answers for it instead of this plan (`billCover`). */ cover?: BillCover | null }[];
  show: { loans: boolean; cards: boolean; bills: boolean };
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
}

/**
 * What already answers for a bill, so the plan lists it without counting it and the Cashflow row does not ask for it:
 * the credit card whose statement it lands on, or the household member who pays it from an account of their own.
 */
export type BillCover = { card: string } | { member: string | null };

/**
 * A bill's cover from the account it is paid from (`moneyAccountId`), read the same on every phone of a shared
 * workspace. On this phone's list, a credit card is the card and any other account is this phone's own to pay. Not on
 * its list, the account is another member's own: a bill arrives on a partner's phone naming a placeholder for its payer,
 * never their account (spec §4.4), so whether it is a card cannot be known here — and the payer's phone already
 * reminds them, by its card or on its own row. Left to the payer, then, by the member's name when it is theirs
 * (`memberPayers`, the placeholders by name). So a bill on her own card is out of both phones' Cashflow rows and both
 * plans' totals alike.
 */
export function billCover(
  accountId: string,
  accounts: readonly { id: string; subtype: string; name: string }[],
  memberPayers: ReadonlyMap<string, string>,
): BillCover | null {
  const payer = accounts.find((a) => a.id === accountId);
  if (payer) return payer.subtype === 'credit_card' ? { card: payer.name } : null;
  return { member: memberPayers.get(accountId) ?? null };
}

const coverWords = (cover: BillCover): string => ('card' in cover ? `on ${cover.card}` : `paid by ${cover.member ?? 'another member'}`);

function toBase(minor: number | null, currency: string, base: string, rates: Readonly<Record<string, number>>): number | null {
  if (minor === null) return null;
  if (currency === base) return minor;
  const rate = rates[currency];
  if (rate === undefined || !(rate > 0)) return minor === 0 ? 0 : null;
  return convertMinor(minor, currency, base, rate);
}

type Parts = Omit<PlanItem, 'baseMinor' | 'key' | 'paidOn' | 'fromMessage' | 'dueBaseMinor' | 'paidBaseMinor'> &
  Partial<Pick<PlanItem, 'paidOn' | 'fromMessage'>> & {
    /** In the item's own currency: what it counts toward Due and Paid, when that is not its figure. */
    dueOwn?: number;
    paidOwn?: number;
  };

function build(parts: Parts, id: string, input: MonthInput): PlanItem {
  const { dueOwn, paidOwn, ...rest } = parts;
  const base = (minor: number | null) => toBase(minor, parts.currency, input.baseCurrency, input.ratesToBase);
  return {
    paidOn: null,
    fromMessage: false,
    ...rest,
    key: `${parts.kind}:${id}:${parts.dueOn}`,
    baseMinor: base(parts.minor),
    approximate: parts.approximate || parts.currency !== input.baseCurrency,
    ...(dueOwn !== undefined ? { dueBaseMinor: base(dueOwn) } : {}),
    ...(paidOwn !== undefined ? { paidBaseMinor: base(paidOwn) } : {}),
  };
}

function loanItems(input: MonthInput): PlanItem[] {
  const current = monthOf(input.today);
  const items: PlanItem[] = [];
  for (const debt of input.debts) {
    // A paid-off loan keeps its months behind (its fact holds only instalments up to the pay-off, all paid).
    if (debt.kind !== 'loan' || !debt.accountId || !debt.hasTerms || debt.instalmentOf === null) continue;
    if (debt.paidOff && input.month > current) continue;
    const fact = input.loanFacts.find((f) => f.accountId === debt.accountId);
    if (!fact) continue;
    const tenor = debt.instalmentOf;
    // The plan holds no rate periods per item; the schedule row in the month, or the first one, gives the figure.
    const terms = { periods: [] };
    const base = { kind: 'loan' as const, debtKey: debt.key, name: debt.name, currency: debt.currency, approximate: false };
    if (input.month <= current) {
      for (const due of fact.instalments) {
        const inMonth = monthOf(due.dueOn) === input.month;
        // The current month's late section also carries the instalments still late from earlier months.
        const carried = input.month === current && due.status === 'late' && monthOf(due.dueOn) < input.month;
        if (!inMonth && !carried) continue;
        const paid = due.status === 'paid';
        items.push(
          build(
            {
              ...base,
              title: instalmentTitle(debt.name, due.number, tenor),
              detail: instalmentDetail(due.dueOn, `${input.month}-01`),
              dueOn: due.dueOn,
              status: due.status,
              daysLate: due.status === 'late' ? due.daysLate : 0,
              minor: paid ? due.paidMinor : expectedInstalment(fact, terms, due.dueOn, input.today),
              paidOn: due.paidOn,
              fromMessage: due.fromMessage,
              pay: paid ? null : loanPay(debt.accountId),
            },
            debt.accountId,
            input,
          ),
        );
      }
    } else {
      for (const row of fact.schedule.filter((r) => monthOf(r.onDate) === input.month)) {
        const number = fact.instalments.find((i) => i.dueOn === row.onDate)?.number ?? instalmentNumberFrom(debt, fact, row.onDate);
        items.push(
          build(
            { ...base, title: instalmentTitle(debt.name, number, tenor), detail: instalmentDetail(row.onDate, row.onDate), dueOn: row.onDate, status: 'upcoming', daysLate: 0, minor: row.paymentMinor, pay: loanPay(debt.accountId) },
            debt.accountId,
            input,
          ),
        );
      }
    }
  }
  return items;
}

/**
 * The number of a scheduled instalment ahead: one more than the last tracked one per month in between, or — with
 * nothing tracked — counted back from the tenor, since the schedule's last row is the tenor's last instalment.
 */
function instalmentNumberFrom(debt: PlanDebt, fact: LoanPlanFact, onDate: string): number {
  const last = fact.instalments.at(-1);
  if (last) return last.number + instalmentNumber({ firstPaymentOn: last.dueOn }, onDate) - 1;
  const end = fact.schedule.at(-1);
  if (end && debt.instalmentOf !== null) return debt.instalmentOf - (instalmentNumber({ firstPaymentOn: onDate }, end.onDate) - 1);
  return 1;
}

function cardItems(input: MonthInput): PlanItem[] {
  return input.cards.flatMap((card) => {
    const { statement } = card;
    // A statement that billed nothing and carries nothing asks for nothing.
    if (statement.closingMinor <= 0 && statement.chargesMinor <= 0) return [];
    const left = statement.leftToPayMinor;
    const paid = statement.closed && left !== null && left <= 0;
    const late = !paid && statement.closed && card.dueOn < input.today && (left ?? 0) > 0;
    /*
     * A statement's own share of the months' money: its new charges are what fell due with it, and what has been paid
     * toward them is every payment since it opened less what first went to the balance it carried in. Read this way a
     * balance carried through several statements and cleared by one payment is due once and paid once (spec §6.9).
     */
    const ownCharges = Math.max(0, statement.chargesMinor);
    const paidTowardOwn = Math.min(ownCharges, Math.max(0, statement.creditsMinor + statement.paidSinceMinor - statement.openingMinor));
    const debt = input.debts.find((d) => d.kind === 'card' && d.accountId === card.cardId);
    return [
      build(
        {
          kind: 'card',
          debtKey: debt?.key ?? card.cardId,
          name: card.name,
          title: card.name,
          detail: `Statement · ${dayMonth(card.dueOn)}`,
          dueOn: card.dueOn,
          status: paid ? 'paid' : late ? 'late' : 'upcoming',
          daysLate: late ? daysFrom(card.dueOn, input.today) : 0,
          // Unpaid and closed: what is left of it, the figure Pay next and the card's own page ask for.
          minor: statement.closed && !paid && left !== null ? left : statement.closingMinor,
          dueOwn: ownCharges,
          paidOwn: paidTowardOwn,
          currency: card.currency,
          // Not yet closed: what it has come to so far.
          approximate: !statement.closed,
          pay: paid ? null : cardPay(card.cardId),
        },
        card.cardId,
        input,
      ),
    ];
  });
}

function billItems(input: MonthInput): PlanItem[] {
  const current = monthOf(input.today);
  return input.bills.flatMap(({ row, currency, cover }) => {
    if (row.state === 'skipped' || row.state === 'paused') return [];
    // A bill is due in the month of its pay-by day (spec §6.4); the current month also carries an earlier one still overdue.
    const payMonth = monthOf(row.window.payBy);
    const carried = input.month === current && row.state === 'overdue' && payMonth < input.month;
    if (payMonth !== input.month && !carried) return [];
    const paid = row.state === 'paid';
    const late = row.state === 'overdue';
    const dueOn = row.window.payBy;
    return [
      build(
        {
          kind: 'bill',
          debtKey: null,
          name: row.bill.name,
          title: row.bill.name,
          // Paid on a credit card, the bill lands on that card's statement: listed, but the statement counts it. Paid by
          // another member from an account of theirs, it is theirs to count (`billCover`).
          detail: cover ? `Bill · ${dayMonth(dueOn)} · ${coverWords(cover)}` : `Bill · ${dayMonth(dueOn)}`,
          inTotals: !cover,
          dueOn,
          status: paid ? 'paid' : late ? 'late' : 'upcoming',
          daysLate: late ? Math.max(1, daysFrom(dueOn, input.today)) : 0,
          minor: paid ? (row.paidMinor ?? row.estimateMinor) : (row.bill.amountMinor ?? row.estimateMinor),
          currency: paid && row.paidCurrency ? row.paidCurrency : currency,
          // A bill whose amount varies is an estimate until it is paid.
          approximate: !paid && row.bill.amountMinor === null,
          paidOn: row.paidOn,
          pay: paid ? null : billPay(row.bill.id),
        },
        row.bill.id,
        input,
      ),
    ];
  });
}

function personItems(input: MonthInput): PlanItem[] {
  const current = monthOf(input.today);
  return input.debts.flatMap((debt) => {
    const next = debt.kind === 'person' && !debt.paidOff ? debt.next : null;
    if (!next) return [];
    const inMonth = monthOf(next.dueOn) === input.month;
    const carried = input.month === current && next.status === 'late' && monthOf(next.dueOn) < input.month;
    return inMonth || carried ? [next] : [];
  });
}

/** Every item of the month the switches let through: loans (with Lend & borrow), cards and bills. */
export function monthItems(input: MonthInput): PlanItem[] {
  return [
    ...(input.show.loans ? [...loanItems(input), ...personItems(input)] : []),
    ...(input.show.cards ? cardItems(input) : []),
    ...(input.show.bills ? billItems(input) : []),
  ];
}

/** A bill as the Recurring list already reads it this month (`monthlyBills`), for the Cashflow row. */
export interface DueBill {
  bill: { id: string; name: string; amountMinor: number | null; window: { payBy: string }; state: BillMonthRow['state']; estimateMinor: number | null };
  currency: string;
  cover: BillCover | null;
}

/**
 * The Cashflow row's items from what is already read (spec §4.6): each loan's late instalments and next one, each
 * card's statement (the plan's own reading, `useCardFacts`), and this month's bills as Recurring lists them. No month is
 * read for it. Paid, skipped and paused bills are left out, and a bill something else answers for (`billCover`): one
 * paid from a card (its statement asks) or by another member from an account of theirs (their phone asks).
 */
export function dueItems(input: { debts: readonly PlanDebt[]; loanFacts: readonly LoanPlanFact[]; bills: readonly DueBill[]; today: string; baseCurrency?: string; ratesToBase?: Readonly<Record<string, number>> }): PlanItem[] {
  const month = monthOf(input.today);
  const context = {
    month,
    today: input.today,
    debts: input.debts,
    loanFacts: input.loanFacts,
    cards: [],
    bills: [],
    show: { loans: true, cards: true, bills: true },
    baseCurrency: input.baseCurrency ?? input.debts[0]?.currency ?? 'IDR',
    ratesToBase: input.ratesToBase ?? {},
  } satisfies MonthInput;
  const items: PlanItem[] = [];
  for (const debt of input.debts) {
    if (debt.paidOff || !debt.next) continue;
    if (debt.kind === 'loan') {
      // Every late instalment (the oldest is also `next`), then the next one when nothing is late.
      const late = loanItems({ ...context, debts: [debt] }).filter((i) => i.status === 'late');
      items.push(...late);
      if (debt.next.status === 'upcoming') items.push(debt.next);
    } else if (debt.kind === 'card') items.push(debt.next);
  }
  for (const { bill, currency, cover } of input.bills) {
    if (cover || bill.state === 'paid' || bill.state === 'skipped' || bill.state === 'paused') continue;
    const late = bill.state === 'overdue';
    const dueOn = bill.window.payBy;
    items.push(
      build(
        {
          kind: 'bill',
          debtKey: null,
          name: bill.name,
          title: bill.name,
          detail: `Bill · ${dayMonth(dueOn)}`,
          dueOn,
          status: late ? 'late' : 'upcoming',
          daysLate: late ? Math.max(1, daysFrom(dueOn, input.today)) : 0,
          minor: bill.amountMinor ?? bill.estimateMinor,
          currency,
          approximate: bill.amountMinor === null,
          pay: billPay(bill.id),
        },
        bill.id,
        context,
      ),
    );
  }
  return items;
}

/** Late (oldest first), coming up (soonest first), paid (newest first). */
export function monthSections(items: readonly PlanItem[], month: string, today: string): { late: PlanItem[]; comingUp: PlanItem[]; paid: PlanItem[] } {
  void month;
  void today;
  const byDue = (a: PlanItem, b: PlanItem) => a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title);
  return {
    late: items.filter((i) => i.status === 'late').sort(byDue),
    comingUp: items.filter((i) => i.status === 'upcoming').sort(byDue),
    paid: items.filter((i) => i.status === 'paid').sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? '') || byDue(a, b)),
  };
}

/** What an item counts toward Due: its own share when it carries one (a card statement), else its figure. */
export const dueFigure = (item: PlanItem): number | null => (item.dueBaseMinor !== undefined ? item.dueBaseMinor : item.baseMinor);

/** What an item counts toward Paid: what has gone toward its share, else its figure once it is paid. */
export const paidFigure = (item: PlanItem): number | null =>
  item.paidBaseMinor !== undefined ? item.paidBaseMinor : item.status === 'paid' ? item.baseMinor : 0;

/** Spec §6.9: Due is every item due in the month (paid ones at what was paid), Paid the paid ones, Late every late one listed. */
export function monthTotals(items: readonly PlanItem[], month: string): { dueMinor: number; paidMinor: number; lateMinor: number; missing: string[] } {
  const missing = new Set<string>();
  const counted = items.filter((i) => i.inTotals !== false);
  const sum = (list: readonly PlanItem[], pick: (item: PlanItem) => number | null | undefined) =>
    list.reduce((total, item) => {
      const figure = pick(item);
      if (item.minor !== null && figure === null) missing.add(item.currency);
      return total + (figure ?? 0);
    }, 0);
  const due = counted.filter((i) => monthOf(i.dueOn) === month);
  return {
    dueMinor: sum(due, dueFigure),
    paidMinor: sum(due, paidFigure),
    lateMinor: sum(
      counted.filter((i) => i.status === 'late'),
      (i) => i.baseMinor,
    ),
    missing: [...missing].sort(),
  };
}

/** "5 due this month": unpaid items due in the month, bills included. */
export function dueThisMonthCount(items: readonly PlanItem[], month: string): number {
  return items.filter((i) => i.status !== 'paid' && monthOf(i.dueOn) === month).length;
}

export interface DueRowModel {
  item: PlanItem;
  title: string;
  subtitle: string;
  tone: 'alarm' | 'warn';
  /** How many more items are late or due soon. */
  rest: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Due today", "Due tomorrow", "Due in 3 days", or "15 days late" — late only for an item counted late. */
function stateWords(item: PlanItem, today: string): string {
  if (item.status === 'late') return `${plural(Math.max(1, item.daysLate), 'day')} late`;
  const days = daysFrom(today, item.dueOn);
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

const lower = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);

/** The Cashflow row (spec §4.6): instalments, statements and bills late or due within BILL_DUE_SOON_DAYS; null when none. */
export function dueRow(items: readonly PlanItem[], today: string): DueRowModel | null {
  const urgent = items
    .filter((i) => i.kind !== 'person' && i.status !== 'paid' && i.pay !== null && i.inTotals !== false)
    .filter((i) => i.status === 'late' || daysFrom(today, i.dueOn) <= BILL_DUE_SOON_DAYS)
    .sort((a, b) => {
      const lateA = a.status === 'late' ? 1 : 0;
      const lateB = b.status === 'late' ? 1 : 0;
      return lateB - lateA || b.daysLate - a.daysLate || a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title);
    });
  const head = urgent[0];
  if (!head) return null;
  const rest = urgent.length - 1;
  const second = urgent[1];
  const restWords = !second ? null : rest > 1 ? `+${rest} more` : second.status === 'late' ? '+1 late' : `+1 ${lower(stateWords(second, today))}`;
  const title = head.kind === 'loan' ? `${head.name} instalment` : head.kind === 'card' ? `${head.name} statement` : head.name;
  return { item: head, title, subtitle: [stateWords(head, today), restWords].filter(Boolean).join(' · '), tone: urgent.some((i) => i.status === 'late') ? 'alarm' : 'warn', rest };
}
