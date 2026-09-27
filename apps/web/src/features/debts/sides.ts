import type { DebtDirection } from '@expanses/core';

/** The two sides of Lend & borrow, as the page and its address name them. */
export type Side = 'owed' | 'owe';

/** Money you lent waits under Receivables; money you borrowed under Payables. */
export const sideOf = (direction: DebtDirection): Side => (direction === 'lent' ? 'owed' : 'owe');

/** The screen that adds to a side. */
export const newDebtPath = (side: Side) => (side === 'owed' ? '/net-worth/lend-borrow/new-receivable' : '/net-worth/lend-borrow/new-payable');

/**
 * Which side the phone opens on. The address's own `side` first — the way back from New receivable or New payable,
 * so saving lands on what was just added to. Then, with one person named, the side that person is on: opening Dewi's
 * row must show Dewi, not an empty list. Receivables otherwise. Never derived from how many rows each side has, so a
 * reader who forgives their last borrower does not have the list switch sides under them.
 */
export function openingSide(input: { asked?: Side; person?: string; owedToYouCount: number }): Side {
  if (input.asked) return input.asked;
  return input.person && input.owedToYouCount === 0 ? 'owe' : 'owed';
}
