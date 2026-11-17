/**
 * Cashback & Rewards into a credit card (owner, 17 Nov 2026): money back typed as a refund (an expense, minus first)
 * whose Into is a credit card. It lowers the card's balance as any refund does and lowers the month's total spending,
 * but it is no category's refund — Groceries keeps its full amount — and it never adds to income. Cashback into a
 * bank, cash or a wallet stays Income › Cashback & Rewards (`income.cashback`).
 *
 * Not a default category: one per book (or workspace), made the first time one is saved, at the top of the spending
 * tree, under an id every device works out alike. Pickers never offer it in the ordinary list; the Add screen offers it
 * alone, at the top, when the money goes back into a credit card.
 */
export const CARD_CASHBACK = { key: 'expense.cashback', name: 'Cashback & Rewards', kind: 'expense' } as const;

/** Whether a category's key is card cashback's. */
export const isCardCashbackKey = (key: string | null | undefined): boolean => key === CARD_CASHBACK.key;
