import { memberTransfersOf, type TransactionView } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useAccounts, useIsBookShared } from '../../lib/queries';
import { usePurchasePayers } from '../sharing/queries';
import { canDuplicate } from './tx-form';

/**
 * `canDuplicate` for these transactions, with the three facts it needs read here once: the accounts this device
 * lists, who paid in a shared workspace, and which are this phone's side of a transfer with a partner.
 *
 * One rule for every way in — the swipe, the receipt, the desktop's buttons and the route — so none of them can
 * offer what another skips. Nothing is offered until the transfers have been read.
 */
export function useDuplicable(transactions: readonly TransactionView[]): ((tx: TransactionView) => boolean) & { ready: boolean } {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const ids = transactions.map((tx) => tx.id);
  const shared = useIsBookShared();
  const payerOf = usePurchasePayers(ids, shared);
  const transfers = useQuery({
    queryKey: ['member-transfers-of', ws.workspaceId, [...ids].sort().join(',')],
    enabled: ids.length > 0,
    queryFn: () => memberTransfersOf(database, ids),
  });
  const known = new Set(accounts.map((account) => account.id));
  // `ready` is for a screen that redirects on a refusal: until the transfers and the accounts are read, "no" means "not yet".
  const ready = transfers.isSuccess && known.size > 0;
  return Object.assign(
    (tx: TransactionView) => ready && canDuplicate(tx, { known, payer: payerOf(tx.id), memberTransfer: !!transfers.data?.[tx.id] }),
    { ready },
  );
}
