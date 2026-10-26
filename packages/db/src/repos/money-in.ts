import { cardTopUpLines } from '@expanses/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cards } from '../schema-cards';
import { type AccountRow, SPENDABLE_SUBTYPES } from './accounts';
import { categoryIdsByKeyTx, ensureCategoryByKeyTx } from './categories';
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

/**
 * What a card's top-up of a wallet is, to its points: not a fee (Fees & charges never earns) but a charge of its own,
 * whose MCC is set once on that category — 5999 or 6540, whatever the issuer prints. A default child of Miscellaneous,
 * offered to file under like any other; a book without one (put away, or from before it was a default) gets it made
 * there on first need.
 */
export const TOP_UP_KEY = { key: 'miscellaneous.top_ups', name: 'Top-ups' };

/**
 * A credit card topping up a digital wallet or an electronic money card — the one way a card's money moves anywhere but
 * to a purchase. Its card line names Top-ups, whichever door records it: this one, or the Transfer tab.
 */
export function cardTopsUpWallet(from: Pick<AccountRow, 'kind' | 'subtype'>, to: Pick<AccountRow, 'kind' | 'subtype'>): boolean {
  return from.kind === 'liability' && from.subtype === 'credit_card' && to.kind === 'asset' && (to.subtype === 'ewallet' || to.subtype === 'emoney');
}

/** The open book's Top-ups, made under its Miscellaneous the first time a book without one needs it. */
export function ensureTopUpsCategoryTx(tx: Db, ws: WorkspaceContext): Promise<string> {
  return ensureCategoryByKeyTx(tx, ws, { ...TOP_UP_KEY, kind: 'expense', parentKey: 'miscellaneous' });
}

/** `ensureTopUpsCategoryTx` in a transaction of its own, for a screen's save. */
export function topUpsCategory(database: Database, ws: WorkspaceContext): Promise<string> {
  return database.transaction((tx) => ensureTopUpsCategoryTx(tx, ws));
}

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
 * one thing, and Cashflow counts the fee and nothing else. Paid by card, the two are one transaction instead, as the
 * card's statement prints them as one charge.
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
    if (to.kind !== 'asset' || (to.subtype !== 'cash' && to.subtype !== 'ewallet' && to.subtype !== 'emoney')) throw new MoneyInError('NOT_ALLOWED', `${to.name} is not cash or a wallet`);
    const card = from.kind === 'liability' && from.subtype === 'credit_card';
    if (from.id === to.id || !((from.kind === 'asset' && SPENDABLE_SUBTYPES.includes(from.subtype)) || cardTopsUpWallet(from, to))) {
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
    /*
     * Paid by card with a fee, it is one charge on the statement — Rp 1.010.000 for Rp 1.000.000 landing — so it is one
     * transaction: the wallet gets the amount, the card owes both, the fee is spending. The card's line names the fee's
     * category, so its points are read once on the whole charge, as the bank reads it.
     */
    if (card) {
      /*
       * The card's line names Top-ups, so its points are read once on the whole charge, as the bank reads it — never
       * under the fee's category, which a card's rules treat as a bank charge that earns nothing.
       */
      const topUps = await ensureTopUpsCategoryTx(tx, ws);
      const feeCategory = input.feeMinor > 0 ? (await categoryIdsByKeyTx(tx, ws))[MONEY_IN_FEE_KEY] : undefined;
      if (input.feeMinor > 0 && !feeCategory) throw new MoneyInError('NOT_FOUND', 'This workspace has no Fees & charges category');
      const transferId = await postTransactionTx(tx, ws, {
        occurredOn: input.occurredOn,
        description: input.description,
        cardId,
        lines: cardTopUpLines({
          cardAccountId: from.id,
          walletAccountId: to.id,
          chargedMinor: input.amountMinor + input.feeMinor,
          feeMinor: input.feeMinor,
          currency,
          topUpsCategoryId: topUps,
          feeCategoryId: feeCategory ?? null,
        }),
        ratesToBase,
        fileTransfer: true,
      });
      return { transferId, feeId: null };
    }
    const transferId = await postTransactionTx(tx, ws, {
      occurredOn: input.occurredOn,
      description: input.description,
      cardId,
      lines: [
        { accountId: to.id, amountMinor: input.amountMinor, currency },
        { accountId: from.id, amountMinor: -input.amountMinor, currency },
      ],
      ratesToBase,
      fileTransfer: true,
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
