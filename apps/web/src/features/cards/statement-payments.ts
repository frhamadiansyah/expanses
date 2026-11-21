import type { CardStatement, StatementLine } from '@expanses/db';
import { statementTotals } from './statement-totals';

/**
 * A card payment on a statement: money put onto the card from elsewhere — a bill payment, a batch paid for chosen
 * purchases, a correction — as opposed to a purchase, money back, a fee or an instalment. Payments are kept off the
 * statement's purchase list (owner, 21 Nov 2026); the totals box's Paid opens them instead.
 */
export const isPaymentLine = (line: StatementLine) => !line.spending && line.owedMinor < 0 && !line.balancing && line.owedOf === undefined;

/** One payment or money back in the Paid sheet, with how much of it counts toward the figure tapped. */
export interface PaidEntry {
  line: StatementLine;
  /** What counts toward the figure, positive: the whole of it, or the part the bill still needed. */
  countedMinor: number;
  /** The whole of it, positive. */
  wholeMinor: number;
  /** Money back on the card (a refund) rather than a payment. */
  refund: boolean;
}

export interface StatementPaid {
  /** The totals row that opens the sheet: Paid on a closed statement, Previous bill on an open one. */
  row: 'Paid' | 'Previous bill';
  /** The sheet's figure: the band's Paid on a closed statement, what the listed payments add to on an open one. */
  totalMinor: number;
  /** What makes up the figure, oldest first. */
  entries: PaidEntry[];
  /**
   * On a closed statement, the payments made between its own dates. They come off the bill before it first, so they
   * are not in its Paid; they are listed apart, so a payment taken off the list can still be reached from here.
   */
  during: PaidEntry[];
}

const whole = (line: StatementLine): PaidEntry => ({ line, countedMinor: -line.owedMinor, wholeMinor: -line.owedMinor, refund: line.spending });

/**
 * The payments the totals box's Paid opens. A closed statement's Paid is what was paid after its statement date, up to
 * its bill: the credits since, oldest first, as a bank clears them, the last one only as far as the bill still needed.
 * An open statement has no Paid row; its payments, which go to the bill before it first, open from Previous bill.
 */
export function statementPaid(s: CardStatement): StatementPaid {
  const own = s.lines.filter(isPaymentLine).map(whole);
  if (!s.closed) return { row: 'Previous bill', totalMinor: own.reduce((sum, entry) => sum + entry.countedMinor, 0), entries: own, during: [] };
  const paidMinor = statementTotals(s).paidMinor;
  const entries: PaidEntry[] = [];
  let left = paidMinor;
  for (const line of s.laterCredits) {
    if (left <= 0) break;
    if (line.owedMinor >= 0 || line.balancing) continue;
    const entry = whole(line);
    const counted = Math.min(entry.wholeMinor, left);
    entries.push({ ...entry, countedMinor: counted });
    left -= counted;
  }
  return { row: 'Paid', totalMinor: paidMinor, entries, during: own };
}

/** The sheet's foot: payments stay in Cashflow and on the account that paid them, or on the paying accounts. */
export function paidFootText(fromNames: readonly (string | null)[]): string | null {
  const named = [...new Set(fromNames.filter((name): name is string => Boolean(name)))];
  if (fromNames.length === 0) return null;
  return `Payments stay in Cashflow and on ${named.length === 1 ? named[0] : 'the paying accounts'} as transfers.`;
}
