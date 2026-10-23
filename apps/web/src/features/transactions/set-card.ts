import type { CardRow } from '@expanses/db';

/** What Set card reads of a ticked transaction: the accounts its lines are on, and the card it already names. */
export interface CardCandidate {
  cardId: string | null;
  entries: readonly { accountId: string }[];
}

/**
 * The credit card account Set card would set the card on, or null when it is not offered: every ticked transaction
 * on one and the same credit card account (and on no other), and that account carrying two cards or more — with one
 * card there is nothing to choose, and the ledger names it already.
 */
export function setCardAccount(
  chosen: readonly CardCandidate[],
  isCreditCard: (accountId: string) => boolean,
  cards: readonly Pick<CardRow, 'accountId'>[],
): string | null {
  let only: string | null = null;
  for (const tx of chosen) {
    const onCards = [...new Set(tx.entries.map((entry) => entry.accountId).filter(isCreditCard))];
    if (onCards.length !== 1) return null;
    if (only !== null && onCards[0] !== only) return null;
    only = onCards[0]!;
  }
  if (only === null) return null;
  return cards.filter((card) => card.accountId === only).length >= 2 ? only : null;
}

/** The card every ticked transaction already names, when they all name the same one; '' otherwise. */
export function sharedCard(chosen: readonly CardCandidate[]): string {
  const first = chosen[0]?.cardId ?? null;
  return first !== null && chosen.every((tx) => tx.cardId === first) ? first : '';
}
