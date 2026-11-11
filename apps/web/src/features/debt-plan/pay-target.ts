/**
 * Where each Pay button goes: the debt's own page, with the one search param that opens its existing pay sheet on
 * arrival. Nothing here posts; the target page's own sheet does, and goes back here after Save or Cancel.
 */
export type PayTarget =
  | { to: '/net-worth/loans/$accountId'; params: { accountId: string }; search: { pay: 'due' | 'extra' } }
  | { to: '/cards/$cardId'; params: { cardId: string }; search: { pay: true } }
  | { to: '/bills/$billId'; params: { billId: string }; search: { pay: true } }
  | { to: '/net-worth/lend-borrow/loan/$accountId'; params: { accountId: string }; search: { repay: true } };

export const loanPay = (accountId: string, what: 'due' | 'extra' = 'due'): PayTarget => ({ to: '/net-worth/loans/$accountId', params: { accountId }, search: { pay: what } });
export const cardPay = (cardId: string): PayTarget => ({ to: '/cards/$cardId', params: { cardId }, search: { pay: true } });
export const billPay = (billId: string): PayTarget => ({ to: '/bills/$billId', params: { billId }, search: { pay: true } });
export const personPay = (accountId: string): PayTarget => ({ to: '/net-worth/lend-borrow/loan/$accountId', params: { accountId }, search: { repay: true } });

/** Where a debt opens, by the Liabilities page's own rule: a loan its page, a card the card, a person Lend & borrow for them. */
export type DebtLink =
  | { to: '/net-worth/loans/$accountId'; params: { accountId: string } }
  | { to: '/cards/$cardId'; params: { cardId: string } }
  | { to: '/net-worth/lend-borrow'; search: { person?: string } };

export function debtLink(debt: { kind: 'loan' | 'card' | 'person' | 'payable'; accountId: string | null; personName: string | null }): DebtLink {
  if (debt.kind === 'loan' && debt.accountId) return { to: '/net-worth/loans/$accountId', params: { accountId: debt.accountId } };
  if (debt.kind === 'card' && debt.accountId) return { to: '/cards/$cardId', params: { cardId: debt.accountId } };
  return { to: '/net-worth/lend-borrow', search: debt.personName ? { person: debt.personName } : {} };
}
