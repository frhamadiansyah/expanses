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
