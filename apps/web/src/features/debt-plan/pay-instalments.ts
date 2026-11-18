import { type Database, nextPaymentDue, recordLoanPayment, type SetAsideChoice, voidTransaction, type WorkspaceContext } from '@expanses/db';
import { paymentDraftFrom, paymentDraftToInput } from '../loans/loan-form';

/**
 * Paying several instalments in one go (Mac Debt-free plan: Pay all on a loan's late row, Pay N on the ticked rows):
 * each is the loan page's own Pay, one after another — the schedule's next split (principal and interest), dated today,
 * from the account picked, recorded by `recordLoanPayment`. A payment always settles the loan's oldest instalment still
 * unpaid (`instalmentStanding`), so N payments settle the N oldest, in order.
 */

export interface LoanToPay {
  accountId: string;
  name: string;
  currency: string;
  count: number;
}

export interface PaidInstalments {
  /** Every payment recorded, in order: what Undo takes back. */
  ids: string[];
  /** What they came to, in the loans' own money (all in the base currency). */
  totalMinor: number;
  /** Loans a payment cleared: marked paid off, which Undo cannot reopen. */
  paidOff: string[];
  /** Where it stopped, when it did: the payments before it stay recorded. */
  error: unknown;
}

export async function payInstalments(
  database: Database,
  ws: WorkspaceContext,
  input: { loans: readonly LoanToPay[]; moneyAccountId: string; today: string; setAside: readonly (SetAsideChoice | null)[] },
): Promise<PaidInstalments> {
  const done: PaidInstalments = { ids: [], totalMinor: 0, paidOff: [], error: null };
  let index = 0;
  try {
    for (const loan of input.loans) {
      for (let n = 0; n < loan.count; n += 1) {
        const row = await nextPaymentDue(database, ws, loan.accountId, input.today);
        if (!row) throw new Error(`${loan.name} has nothing left on its schedule. Pay it from its own page.`);
        const draft = paymentDraftFrom(row, input.today, input.moneyAccountId, loan.currency);
        // The ledger refuses more principal than is owed (`recordLoanPayment`), so no balance is read here.
        const payment = paymentDraftToInput(draft, loan.accountId, loan.currency, Number.MAX_SAFE_INTEGER, loan.name, input.today);
        const result = await recordLoanPayment(database, ws, { ...payment, setAside: input.setAside[index] ?? null });
        index += 1;
        done.ids.push(result.transactionId);
        done.totalMinor += payment.principalMinor + payment.interestMinor;
        if (result.status === 'paid_off') {
          done.paidOff.push(loan.name);
          break;
        }
      }
    }
  } catch (error) {
    done.error = error;
  }
  return done;
}

/** Undo: each payment taken back as a delete would, newest first. */
export async function undoInstalments(database: Database, ws: WorkspaceContext, ids: readonly string[]): Promise<void> {
  for (const id of [...ids].reverse()) await voidTransaction(database, ws, id);
}

/** "Paid 3 instalments of KPR BCA" | "Paid 2 instalments of KPR BCA and 1 of KTA". */
export function paidWords(loans: readonly { name: string; count: number }[]): string {
  const parts = loans.filter((loan) => loan.count > 0).map((loan, i) => (i === 0 ? `${loan.count} ${loan.count === 1 ? 'instalment' : 'instalments'} of ${loan.name}` : `${loan.count} of ${loan.name}`));
  if (parts.length === 0) return 'Paid nothing';
  return `Paid ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}`;
}
