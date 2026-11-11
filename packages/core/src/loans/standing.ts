import { daysFrom } from '../bills/schedule';
import { addMonthsToDate } from '../deposits/maturity';
import { type LoanTerms, paymentDate } from './schedule';

export interface InstalmentDue {
  /** 1 for the loan's first instalment. */
  number: number;
  dueOn: string;
}

export interface InstalmentPayment {
  id: string;
  occurredOn: string;
  /** What the transaction paid: principal plus every line riding on it, in the loan's currency. */
  totalMinor: number;
  /** Recorded from a bank message, notification or screenshot (transactions.source = 'email'). */
  fromMessage: boolean;
}

export type InstalmentStatus = 'paid' | 'late' | 'upcoming';

export interface InstalmentState extends InstalmentDue {
  status: InstalmentStatus;
  paidOn: string | null;
  paymentId: string | null;
  paidMinor: number | null;
  fromMessage: boolean;
  /** Late: days since it fell due. Paid: days after the due day it was paid (0 when on time or early). Upcoming: 0. */
  daysLate: number;
}

/** The instalments due from `fromOn` to `toOn`, both inclusive, never past the tenor. */
export function instalmentDates(terms: Pick<LoanTerms, 'firstPaymentOn' | 'paymentDay' | 'tenorMonths'>, fromOn: string, toOn: string): InstalmentDue[] {
  const dues: InstalmentDue[] = [];
  for (let index = 0; index < terms.tenorMonths; index += 1) {
    const dueOn = paymentDate(terms.firstPaymentOn, terms.paymentDay, index);
    if (dueOn > toOn) break;
    if (dueOn >= fromOn) dues.push({ number: index + 1, dueOn });
  }
  return dues;
}

/**
 * Each instalment's standing, oldest unpaid first, as a lender applies money to arrears: every instalment takes the
 * earliest payment not yet taken that was made after the previous instalment's due day (for the first tracked one,
 * after the same day a month earlier). There is no upper bound, so a late payment settles the oldest missed one and
 * the later one stays late. One payment settles one instalment. Due today is upcoming, not late.
 */
export function instalmentStanding(dues: readonly InstalmentDue[], payments: readonly InstalmentPayment[], today: string): InstalmentState[] {
  const sorted = [...payments].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  return dues.map((due, index): InstalmentState => {
    const after = index > 0 ? dues[index - 1]!.dueOn : addMonthsToDate(due.dueOn, -1);
    const payment = sorted.find((p) => !used.has(p.id) && p.occurredOn > after);
    if (payment) {
      used.add(payment.id);
      return {
        ...due,
        status: 'paid',
        paidOn: payment.occurredOn,
        paymentId: payment.id,
        paidMinor: payment.totalMinor,
        fromMessage: payment.fromMessage,
        daysLate: Math.max(0, daysFrom(due.dueOn, payment.occurredOn)),
      };
    }
    const late = due.dueOn < today;
    return { ...due, status: late ? 'late' : 'upcoming', paidOn: null, paymentId: null, paidMinor: null, fromMessage: false, daysLate: late ? daysFrom(due.dueOn, today) : 0 };
  });
}
