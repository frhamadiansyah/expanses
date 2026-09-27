import { type DebtDirection, dueLabel } from '@expanses/core';
import type { PersonDebtRow, PersonLoanRow } from '@expanses/db';
import type { Side } from './sides';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "23 Jun", or "23 Jun 2025" when it is not this year: a date as a person says it, where the old card printed
 * `2026-06-23`. The year is left off only when it would say nothing.
 */
export function shortDay(isoDay: string, today: string): string {
  const [year, month, day] = isoDay.split('-');
  if (!year || !month || !day) return isoDay;
  const words = `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`;
  return year === today.slice(0, 4) ? words : `${words} ${year}`;
}

/** A person's own page, on the side they are on. The name is the key the list already groups by. */
export const personParams = (person: Pick<PersonDebtRow, 'personName' | 'direction'>): { side: Side; person: string } => ({
  side: person.direction === 'lent' ? 'owed' : 'owe',
  person: person.personName,
});

const open = (person: PersonDebtRow) => person.loans.filter((loan) => loan.status === 'open');

/**
 * The due date that needs attention first across a person's open loans — "11 days overdue" before "Due in 6 days" —
 * for the pill on their row. Empty when none of them has a date.
 */
export function personDue(person: PersonDebtRow, today: string): { label: string; tone: 'late' | 'soon' | 'later' } | null {
  const rank = { overdue: 0, due_soon: 1, none: 2 } as const;
  const dated = open(person)
    .filter((loan) => loan.dueOn)
    .sort((a, b) => rank[a.dueState] - rank[b.dueState] || (a.dueOn ?? '').localeCompare(b.dueOn ?? ''));
  const first = dated[0];
  if (!first) return null;
  const label = dueLabel(first.dueOn, today, first.status);
  if (!label) return null;
  return { label, tone: first.dueState === 'overdue' ? 'late' : first.dueState === 'due_soon' ? 'soon' : 'later' };
}

/**
 * The line under a loan: since when, what it files as, and when it is due. "Since 23 Jun · Affiliate receivables ·
 * Due in 6 days". A finished loan says so instead of a due date.
 */
export function loanSubtitle(loan: PersonLoanRow, codeLabel: string, today: string): string {
  const parts = [`Since ${shortDay(loan.openedOn, today)}`];
  if (codeLabel) parts.push(codeLabel);
  if (loan.status !== 'open') parts.push(loan.status === 'settled' ? 'Settled' : 'Forgiven');
  else {
    const due = dueLabel(loan.dueOn, today, loan.status);
    if (due) parts.push(due);
  }
  return parts.join(' · ');
}

/** Money coming back on a loan you made is a collection; money going back on one you took is a repayment. */
export const repaymentWord = (direction: DebtDirection): string => (direction === 'lent' ? 'Collection' : 'Repayment');

/** The two figures a loan's Details shows beside what is still owed: what first moved, and what has come back. */
export const loanFigureLabels = (direction: DebtDirection): { given: string; back: string } =>
  direction === 'lent' ? { given: 'Money lent', back: 'Money back' } : { given: 'Money borrowed', back: 'Paid back' };

/**
 * What Delete loan asks before it goes: what else goes with it, in the side's own word, and what happens to the
 * money — "Delete this loan and its 2 collections? Every balance goes back as if it was never recorded."
 */
export function deleteLoanQuestion(direction: DebtDirection, moneyBackCount: number): string {
  const word = repaymentWord(direction).toLowerCase();
  const withIt = moneyBackCount === 0 ? '' : ` and its ${moneyBackCount === 1 ? word : `${moneyBackCount} ${word}s`}`;
  return `Delete this loan${withIt}? Every balance goes back as if it was never recorded.`;
}

/**
 * One line of a loan's history, from the owner's side: what it is called and which way the money went. Money coming
 * back on a loan you made, or reaching you as a loan you took, flows in; money handed over flows out; a forgiveness
 * moves no money at all.
 */
export function historyEntry(kind: 'lend' | 'repayment' | 'forgive', direction: DebtDirection): { title: string; flow: 'in' | 'out' | 'none' } {
  if (kind === 'forgive') return { title: 'Forgiven', flow: 'none' };
  if (kind === 'lend') return direction === 'lent' ? { title: 'Lent', flow: 'out' } : { title: 'Borrowed', flow: 'in' };
  return { title: repaymentWord(direction), flow: direction === 'lent' ? 'in' : 'out' };
}
