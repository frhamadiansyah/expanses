import { and, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { cards } from '../schema-cards';
import { SPENDABLE_SUBTYPES } from './accounts';
import { categoryIdsByKeyTx } from './categories';
import { postTransactionTx } from './ledger';

export class MoneyInError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'NOT_ALLOWED' | 'CURRENCY' | 'BAD_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'MoneyInError';
  }
}

/** The category a withdrawal's or a top-up's fee is spent under: the one a bank's other charges use. */
export const MONEY_IN_FEE_KEY = 'miscellaneous.fees_charges';

export interface MoneyInInput {
  /** Cash for a withdrawal, a digital wallet for a top-up. */
  toId: string;
  /** Money you hold; for a top-up into a wallet, a credit card too. */
  fromId: string;
  /** The card on `fromId` it was charged to, when the account carries more than one. */
  cardId?: string | null;
  amountMinor: number;
  /** What the ATM or the wallet charged on top, paid from the same place; 0 for none. */
  feeMinor: number;
  occurredOn: string;
  /** "Cash withdrawal" or "Top up"; the fee reads "ATM fee" or "Top-up fee". */
  description: string;
  feeDescription: string;
  /** Units of base per one major unit of the money's currency, when that is not the base. */
  rateToBase?: number;
}

/**
 * Money into cash or a wallet from somewhere else of one's own — a withdrawal at an ATM, a GoPay top-up — with the
 * fee charged for it, as one step.
 *
 * The money itself is a transfer: not income, not spending. The fee is spending, under Fees & charges, paid from
 * the same place, and is its own transaction beside the transfer, as a deposit's penalty is: each row then says
 * one thing, and Cashflow counts the fee and nothing else.
 *
 * A wallet may also be topped up from a credit card — GoPay and OVO take one — which is the only way a card's money
 * moves anywhere but to a purchase. The card's debt grows by the amount and the fee. It is allowed here and nowhere
 * else: the ordinary transfer still names only money you hold on either side. Both sides are in one currency.
 */
export async function moveMoneyIn(database: Database, ws: WorkspaceContext, input: MoneyInInput): Promise<{ transferId: string; feeId: string | null }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new MoneyInError('BAD_INPUT', 'Choose the day');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new MoneyInError('BAD_INPUT', 'Enter the amount');
  if (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0) throw new MoneyInError('BAD_INPUT', 'A fee cannot be below zero');
  return database.transaction(async (tx) => {
    const both = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.workspaceId, ws.workspaceId), isNull(accounts.archivedAt)));
    const to = both.find((a) => a.id === input.toId);
    const from = both.find((a) => a.id === input.fromId);
    if (!to || !from) throw new MoneyInError('NOT_FOUND', 'That account is not in this workspace');
    if (to.kind !== 'asset' || (to.subtype !== 'cash' && to.subtype !== 'ewallet')) throw new MoneyInError('NOT_ALLOWED', `${to.name} is not cash or a wallet`);
    const card = from.kind === 'liability' && from.subtype === 'credit_card';
    if (from.id === to.id || !((from.kind === 'asset' && SPENDABLE_SUBTYPES.includes(from.subtype)) || (card && to.subtype === 'ewallet'))) {
      throw new MoneyInError('NOT_ALLOWED', `Money cannot come into ${to.name} from ${from.name}`);
    }
    if (from.currency !== to.currency || !to.currency) throw new MoneyInError('CURRENCY', `${from.name} and ${to.name} hold different currencies`);
    const currency = to.currency;
    let cardId: string | null = null;
    if (input.cardId) {
      const [row] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(and(eq(cards.id, input.cardId), eq(cards.accountId, from.id), eq(cards.workspaceId, ws.workspaceId)));
      if (!row) throw new MoneyInError('NOT_FOUND', `That card is not on ${from.name}`);
      cardId = row.id;
    }
    const ratesToBase = input.rateToBase ? { [currency]: input.rateToBase } : {};
    const transferId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.description,
      cardId,
      lines: [
        { accountId: to.id, amountMinor: input.amountMinor, currency },
        { accountId: from.id, amountMinor: -input.amountMinor, currency },
      ],
      ratesToBase,
    });
    if (input.feeMinor === 0) return { transferId, feeId: null };
    const feeCategory = (await categoryIdsByKeyTx(tx, ws))[MONEY_IN_FEE_KEY];
    if (!feeCategory) throw new MoneyInError('NOT_FOUND', 'This workspace has no Fees & charges category');
    const feeId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.feeDescription,
      cardId,
      lines: [
        { accountId: feeCategory, amountMinor: input.feeMinor, currency },
        { accountId: from.id, amountMinor: -input.feeMinor, currency },
      ],
      ratesToBase,
    });
    return { transferId, feeId };
  });
}
