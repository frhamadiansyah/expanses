import type { AccountRow, CardRow } from '@expanses/db';
import { useMemo } from 'react';
import { useInOpenBook } from '../../lib/queries';
import { useAccountNumberLast4, useWalletLast4 } from '../cards/card-queries';
import { useCategorySetMembership } from '../categories/set-queries';
import { buildRowOptions, type RowOptions } from './QuickRowEditor';
import { useShareCategoryIds } from './queries';

/**
 * The choices a table row's cells offer (`buildRowOptions`), read as Cashflow reads them: the open book's categories
 * (never a shared event's copies, never a set's), every money account, and the digits a row shows by an account with no
 * card. Review's rows (Mac, owner 2026-11-24) are Cashflow's waiting rows, so they offer the same; a capture of money in
 * offers money in's categories.
 */
export function useRowOptions(accounts: readonly AccountRow[], cards: readonly CardRow[], ready: boolean): { expense: RowOptions; income: RowOptions } {
  const inBook = useInOpenBook();
  const shareIds = useShareCategoryIds();
  const membershipQuery = useCategorySetMembership();
  const membership = membershipQuery.data ?? {};
  const wallets = useWalletLast4().data;
  const numbers = useAccountNumberLast4().data;
  const digits = useMemo(() => ({ ...(numbers ?? {}), ...(wallets ?? {}) }), [numbers, wallets]);
  const inOpenBook = (a: AccountRow) => inBook(a) && !shareIds.has(a.id);
  const loaded = ready && membershipQuery.isSuccess;
  return {
    expense: buildRowOptions(accounts, cards, inOpenBook, membership, loaded, digits, 'expense'),
    income: buildRowOptions(accounts, cards, inOpenBook, membership, loaded, digits, 'income'),
  };
}
