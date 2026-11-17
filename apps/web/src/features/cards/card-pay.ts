import { minorToMajorString } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import type { CardSeed, ExtraRow } from '../transactions/tx-form';

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
