import { emptyForm, type FormDraft, type WithRow } from './tx-form';

/**
 * The draft the receipt pages carry when a split starts from Account rather than from a purchase: a blank expense
 * with the people sharing it and, when the Default account setting names a way to pay, that account (and card).
 * Nothing about the amount is known yet; the receipt gives it (`withReceiptApplied`).
 */
export function startDraft(bookId: string, people: readonly WithRow[], pay: { accountId: string; cardId?: string | null } | null, today?: string): FormDraft {
  return {
    ...emptyForm(bookId, today),
    mode: 'expense',
    with: people.map((row) => ({ ...row, amount: '' })),
    moneyId: pay?.accountId ?? '',
    cardId: pay?.cardId ?? '',
  };
}
