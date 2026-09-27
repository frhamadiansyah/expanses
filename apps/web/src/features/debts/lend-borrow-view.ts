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

/** "Owes you", "You owe": whose money it is, under a title that already names the person. */
export const owesLine = (direction: DebtDirection): string => (direction === 'lent' ? 'Owes you' : 'You owe');

/** "Andi still owes", "You still owe Dewi", for one loan's page. */
export const stillOwesLine = (direction: DebtDirection, name: string): string =>
  direction === 'lent' ? `${name} still owes` : `You still owe ${name}`;
