import type { CardStatement } from '@expanses/db';

/**
 * What a statement's totals band draws: the stretches of the bar, and the figure beside it.
 *
 * A bank clears the oldest balance first, so a payment comes off the previous bill before it touches
 * anything bought since. That is what `paidMinor` measures; only what is left over reaches this cycle.
 */
export interface StatementTotals {
  /** A closed statement has a bill to settle; an open one is still gathering purchases. */
  closed: boolean;
  /** The previous bill on an open statement, or this statement's own bill once it has closed. */
  billMinor: number;
  paidMinor: number;
  leftMinor: number;
  /** Bought since the last statement, before any payment reached it. Zero on a closed statement. */
  unbilledMinor: number;
  /** The unbilled part still owed, once a payment bigger than the previous bill has spilled into it. */
  unbilledLeftMinor: number;
  /** The upcoming bill, or a closed statement's total bill: what the dark cell prints. */
  totalMinor: number;
  /** What the whole bar measures, for working out each stretch's share. */
  wholeMinor: number;
}

const atLeastNothing = (minor: number) => Math.max(0, minor);

export function statementTotals(s: CardStatement): StatementTotals {
  if (s.closed) {
    const billMinor = atLeastNothing(s.closingMinor);
    const paidMinor = Math.min(atLeastNothing(s.paidSinceMinor), billMinor);
    return {
      closed: true,
      billMinor,
      paidMinor,
      leftMinor: billMinor - paidMinor,
      unbilledMinor: 0,
      unbilledLeftMinor: 0,
      totalMinor: billMinor,
      wholeMinor: billMinor,
    };
  }
  const billMinor = atLeastNothing(s.openingMinor);
  const unbilledMinor = atLeastNothing(s.chargesMinor);
  const credits = atLeastNothing(s.creditsMinor);
  const paidMinor = Math.min(credits, billMinor);
  // Paying more than the previous bill leaves a surplus, and that surplus does sit against this cycle.
  const spilled = Math.min(credits - paidMinor, unbilledMinor);
  return {
    closed: false,
    billMinor,
    paidMinor,
    leftMinor: billMinor - paidMinor,
    unbilledMinor,
    unbilledLeftMinor: unbilledMinor - spilled,
    totalMinor: billMinor - paidMinor + unbilledMinor - spilled,
    wholeMinor: billMinor + unbilledMinor,
  };
}
