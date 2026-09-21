import { createContext, useContext } from 'react';

/**
 * The place an open card's page leaves for the card itself.
 *
 * When a card is opened from the Wallet stack the card does not get redrawn by its page: the stack's own card
 * element rises to the top, at the width it had in the stack, and the page below it leaves an empty slot of exactly
 * that size where a card face would otherwise go. So the card is the page's header, as in Wallet, and one element
 * moves rather than two drawings swapping.
 */
export interface WalletSlot {
  width: number;
  height: number;
  /** Which of the account's plastic cards the raised card shows — the page's dots choose it. */
  setShown: (face: { last4: string | null; holderName?: string | null } | null) => void;
}

export const WalletSlotContext = createContext<WalletSlot | null>(null);

/** The slot to leave for the raised card, or null when the page stands on its own. */
export function useWalletSlot(): WalletSlot | null {
  return useContext(WalletSlotContext);
}
