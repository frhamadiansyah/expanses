import { containsKeyword, coveredCharge, feeWaived, refundLines } from '@expanses/core';
import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { feeFieldsByCard, writeFeeFields } from './fee-columns';
import { postTransactionTx } from './ledger';
import { PointsError } from './points';

/** What a charge for the annual fee is called on a statement. */
const FEE_WORDS = ['annual fee', 'iuran tahunan', 'membership fee', 'annual membership', 'biaya tahunan'];
/** The categories an annual fee is filed under. */
const FEE_KEYS = ['miscellaneous.membership_fee', 'miscellaneous.fees_charges'];
/** How far either side of the stored date a recorded charge still counts as that year's fee. */
const WINDOW_DAYS = 20;

export const WAIVED_DESCRIPTION = 'Annual fee waived';

export interface FeeWaiver {
  /** The refund posted, or null when no charge for that year had been recorded, so nothing was cancelled. */
  transactionId: string | null;
  refundedMinor: number;
}

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The bank agreed not to charge this year's annual fee. Marks that year's charge as waived and, when the fee was
 * recorded on the card (a charge in a fee category, or named like one, around the stored date), refunds it on the
 * card, today, in the category it was filed under. A fee never recorded in the app has nothing to cancel, so only
 * the mark is set. Waiving the same charge twice does nothing the second time.
 */
export async function waiveAnnualFee(database: Database, ws: WorkspaceContext, input: { cardId: string; today: string }): Promise<FeeWaiver> {
  return database.transaction(async (tx) => {
    const [card] = await tx.select({ subtype: accounts.subtype, currency: accounts.currency }).from(accounts).where(and(eq(accounts.id, input.cardId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!card || card.subtype !== 'credit_card') throw new PointsError('Account is not a credit card in this workspace');
    const terms = (await feeFieldsByCard(tx, ws)).get(input.cardId);
    if (!terms?.annualFeeOn) throw new PointsError('This card has no annual fee date');
    if (feeWaived(terms.annualFeeOn, terms.annualFeeWaivedYear, input.today)) return { transactionId: null, refundedMinor: 0 };

    const covered = coveredCharge(terms.annualFeeOn, input.today);
    const rows = await tx.values<[string, string, number, string, string | null]>(sql`
      SELECT t.id, t.description, e.amount_minor, ce.account_id, ca.system_key
      FROM entries e
      JOIN transactions t ON t.id = e.transaction_id AND t.status = 'posted'
      JOIN entries ce ON ce.transaction_id = t.id AND ce.account_id != e.account_id AND ce.amount_minor > 0
      JOIN accounts ca ON ca.id = ce.account_id AND ca.kind = 'expense'
      WHERE e.account_id = ${input.cardId} AND e.workspace_id = ${ws.workspaceId} AND e.amount_minor < 0
        AND t.occurred_on BETWEEN ${shift(covered, -WINDOW_DAYS)} AND ${shift(covered, WINDOW_DAYS)}
        AND t.description != ${WAIVED_DESCRIPTION}
      ORDER BY ABS(julianday(t.occurred_on) - julianday(${covered})) ASC`);
    const fee = rows.find(([, description, , , key]) => (key !== null && FEE_KEYS.includes(key)) || FEE_WORDS.some((word) => containsKeyword(description, word)));

    let transactionId: string | null = null;
    let refundedMinor = 0;
    if (fee) {
      refundedMinor = -fee[2];
      transactionId = await postTransactionTx(tx, ws, {
        occurredOn: input.today,
        description: WAIVED_DESCRIPTION,
        lines: refundLines({ categoryAccountId: fee[3], paymentAccountId: input.cardId, amountMinor: refundedMinor, currency: card.currency ?? ws.baseCurrency }),
      });
    }
    await writeFeeFields(tx, ws, input.cardId, { annualFeeWaivedYear: Number(covered.slice(0, 4)) });
    return { transactionId, refundedMinor };
  });
}
