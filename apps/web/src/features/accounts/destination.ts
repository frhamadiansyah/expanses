import { CASH_ITEMS } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import type { LinkProps } from '@tanstack/react-router';

/** The kinds of account whose own page is on `/accounts`: money, not things. */
export const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

export type AccountDestination = Pick<LinkProps, 'to' | 'params' | 'search'>;

/**
 * Where tapping an account opens, wherever it is listed — Accounts, Net worth's drawers: money on its account page, a
 * card on the card's, a loan on the loan's, money owed to or by a person in Lend & borrow, anything owned on its
 * asset page. One answer, so one tap never means two things depending on which list it was made from.
 */
export function accountDestination(account: AccountRow): AccountDestination {
  if (CASH_SUBTYPES.has(account.subtype)) return { to: '/accounts/$accountId', params: { accountId: account.id } };
  if (account.subtype === 'credit_card') return { to: '/cards/$cardId', params: { cardId: account.id } };
  if (account.subtype === 'loan') return { to: '/net-worth/loans/$accountId', params: { accountId: account.id } };
  if (account.subtype === 'payable' || account.subtype === 'receivable') return { to: '/net-worth/lend-borrow' };
  return { to: '/net-worth/assets/$accountId', params: { accountId: account.id } };
}
