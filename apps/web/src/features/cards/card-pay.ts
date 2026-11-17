import { type Cycle, minorToMajorString } from '@expanses/core';
import type { AccountRow, CardStatement, payCardPurchases, SetAsideChoice, TransactionView } from '@expanses/db';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { classify } from '../transactions/classify';
import type { CardSeed, ExtraRow, FormDraft } from '../transactions/tx-form';
import { payableLine, statementCover } from './statement-cover';

/*
 * A credit card's round Pay (owner, 17 Nov 2026): the ordinary Add screen in its Transfer layout, locked to paying the
 * card. No tabs, To fixed on the card, From left to be chosen, the bill filled in. It saves through the Add screen's
 * own transfer save, which posts the very lines the old "Pay <card>" sheet's Record payment posted (`card-pay.test.ts`).
 * A plain transfer still never names a card (`canTransferWith`): only this locked screen has one as its To.
 */

/** The note a card's payment opens with; editable. Never the card's name, which the screen does not show in words. */
export const CARD_PAY_NOTE = 'Credit card payment';

/** Not offered under Add more details: a card payment never counts in Cashflow, so there is nothing to exclude. */
export const CARD_PAY_OMITS: readonly ExtraRow[] = ['exclude'];

/**
 * Whether the form offers a transfer's Goal row: a new transfer, with goals to choose from — and never a card payment
 * (the card's Pay, Edit payment, the statement's Pay; owner, 17 Nov 2026). Paying a card is never saving toward a goal;
 * the set-aside question, which asks about money already promised to one, is a different thing and stays.
 */
export function offersTransferGoal(draft: Pick<FormDraft, 'mode'>, o: { editing: boolean; payCard: boolean; goals: number }): boolean {
  return draft.mode === 'transfer' && !o.editing && !o.payCard && o.goals > 0;
}

/** The address of a card's Pay: the Add screen locked to this card, with the figure the card page fills in. */
export function cardPayLink(cardId: string, amountMinor: number, currency: string) {
  return {
    to: '/transactions/new' as const,
    search: { pay: cardId, ...(amountMinor > 0 ? { amount: minorToMajorString(amountMinor, currency) } : {}) },
  };
}

/** What the Pay screen opens with: To is the card, the note says what it is, the amount is the bill. From is chosen. */
export function cardPaySeed(cardId: string, amount: string | undefined): CardSeed {
  return { toId: cardId, description: CARD_PAY_NOTE, ...(amount ? { amount } : {}) };
}

/**
 * What may pay the card: the Transfer From list, kept to the card's own currency as the old sheet kept it, so a
 * payment is always the one same-currency transfer it always was and never an exchange.
 */
export function cardPayFrom<T extends Pick<AccountRow, 'id' | 'currency'>>(money: readonly T[], card: Pick<AccountRow, 'id' | 'currency'> | undefined): T[] {
  if (!card) return [];
  return money.filter((account) => account.id !== card.id && account.currency === card.currency);
}

/*
 * A saved card payment, edited (owner, 17 Nov 2026): the Edit screen opens as "Edit payment", in the Pay screen's
 * layout — no tabs, To the card and fixed — and saves through the one edit path every transaction saves through.
 */

/**
 * Whether a saved transaction is a payment into a credit card from one of the owner's own money accounts: a transfer
 * of two money lines in one currency, the card's the one the money landed on. That is what the card page's Pay, the old
 * Record payment and the statement's chosen purchases (`payCardPurchases`) all post, a fee beside it or not. A card's
 * own spending, a top-up paid by the card, and a statement check's payment from a correction are not.
 */
export function isCardPayment(tx: TransactionView): boolean {
  if (tx.goalId || classify(tx).type !== 'transfer') return false;
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  if (money.length !== 2) return false;
  const to = money.find((e) => e.amountMinor > 0);
  const from = money.find((e) => e.amountMinor < 0);
  if (!to || !from || to.accountSubtype !== 'credit_card') return false;
  return (MONEY_SUBTYPES as readonly string[]).includes(from.accountSubtype ?? '') && from.currency === to.currency;
}

/*
 * The statement's Pay for chosen purchases (owner, 17 Nov 2026): the same "Pay credit card" screen, the purchases
 * listed under it and the amount their total, fixed. It saves with `payCardPurchases`, which marks exactly those
 * purchases paid, called as the old "Pay N purchases" sheet called it, the note added (`card-pay.test.ts`).
 */

/** One chosen purchase as the screen lists it: its words, and what is left of it to pay (all of it, unless covered in part). */
export interface StatementPayPurchase {
  transactionId: string;
  description: string;
  owedMinor: number;
  leftMinor: number;
}

/** The statement's Pay: the Pay screen's address, naming the purchases ticked and the statement they were ticked on. */
export function statementPayLink(cardId: string, cycle: Cycle, today: string, ids: readonly string[]) {
  return {
    to: '/transactions/new' as const,
    search: { pay: cardId, purchases: ids.join(','), start: cycle.start, end: cycle.end, today },
  };
}

/** The ticked purchases the statement still lets be paid, in its order, each with what is left of it: what the sheet listed. */
export function statementPayChoice(statement: CardStatement, ids: readonly string[]): StatementPayPurchase[] {
  const cover = statementCover(statement);
  return statement.lines
    .filter((line) => ids.includes(line.transactionId) && payableLine(line, cover))
    .map((line) => ({ transactionId: line.transactionId, description: line.description, owedMinor: line.owedMinor, leftMinor: cover.get(line.key)?.leftMinor ?? line.owedMinor }));
}

/** What the screen opens with: To the card, the note, the amount what is left of the purchases. From is chosen. */
export function statementPaySeed(cardId: string, purchases: readonly StatementPayPurchase[], currency: string): CardSeed {
  const totalMinor = purchases.reduce((sum, p) => sum + p.leftMinor, 0);
  return { toId: cardId, description: CARD_PAY_NOTE, amount: minorToMajorString(totalMinor, currency) };
}

/**
 * The `payCardPurchases` call Save makes: the sheet's own (the card, From, the day, the purchases, what is left of any
 * covered in part, the day the statement was read, the set-aside answer), with the screen's note as the description.
 */
export function statementPayInput(
  o: { cardAccountId: string; purchases: readonly StatementPayPurchase[]; today: string },
  draft: Pick<FormDraft, 'moneyId' | 'occurredOn' | 'description'>,
  setAside: SetAsideChoice | null,
): Parameters<typeof payCardPurchases>[2] & { amountsMinor: Record<string, number>; description: string } {
  return {
    cardAccountId: o.cardAccountId,
    fromAccountId: draft.moneyId,
    occurredOn: draft.occurredOn,
    purchaseTransactionIds: o.purchases.map((p) => p.transactionId),
    // A purchase a payment partly covered pays only what is left of it.
    amountsMinor: Object.fromEntries(o.purchases.filter((p) => p.leftMinor !== p.owedMinor).map((p) => [p.transactionId, p.leftMinor])),
    // The ledger checks those amounts against its own cover as of the day the statement was read.
    today: o.today,
    setAside,
    description: draft.description,
  };
}
