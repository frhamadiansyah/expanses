import { listTransactions, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { BackButton } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { Card } from '../../ui';
import { isEditable } from './draft';
import { useChangeable } from './queries';
import { TransactionCard } from './TransactionCard';

/**
 * `/transactions/new` — the card as a screen.
 *
 * A static segment outranks a dynamic one in this router, so this is matched before `/transactions/$transactionId`
 * and "new" is never read as an id. `add-transaction.spec.ts` asserts exactly that rather than trusting it.
 */
export function NewTransactionRoute() {
  const navigate = useNavigate();
  const done = () => void navigate({ to: '/transactions' });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BackButton fallback="/transactions" />
        <h1 className="text-lg font-semibold">Add a transaction</h1>
      </div>
      <TransactionCard full onDone={done} />
    </div>
  );
}

const route = getRouteApi('/transactions/$transactionId/edit');

/**
 * `/transactions/$transactionId/edit` — the same card, opened on one transaction.
 *
 * Task 10 deleted a route of this name and said why: it was written, nothing ever linked to it, and a surface
 * re-stating the three refusals that no user could reach and no test ran looks like protection and is not. The
 * condition it left behind was "when something needs a route to edit on, it brings the route and the tests with
 * it". The edit sheet's ⋯ is that something — **Open in full form** is what a split, a transfer or anything else
 * the sheet cannot hold is reached by — and `phone-transaction-gestures.spec.ts` walks it.
 *
 * The refusals are not re-stated here either. `useChangeable` answers them, and what it refuses is sent to the
 * receipt, which already says in words which workspace to open, or that a trade is corrected on Buy & sell.
 */
export function EditTransactionRoute() {
  const { transactionId } = route.useParams();
  const { database, ws } = useApp();
  const navigate = useNavigate();
  // The receipt's own key and the receipt's own read: owner-wide, because an account's history is the owner's
  // and a deep link may name a transaction filed in another workspace.
  const receipt = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = receipt.data ?? null;
  const { changeable, elsewhere, isTrade } = useChangeable(tx);
  // Only the settled refusals send anyone away. `changeable` is also false while the trades are still being
  // read, and redirecting on that would bounce a perfectly editable transaction out of its own form.
  const refused = receipt.isSuccess && (!tx || elsewhere !== null || isTrade || !isEditable(tx));

  useEffect(() => {
    if (refused) void navigate({ to: '/transactions/$transactionId', params: { transactionId } });
  }, [refused, transactionId]);

  if (!tx || !changeable) return <Card>Loading…</Card>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <BackButton fallback="/transactions" />
        <h1 className="text-lg font-semibold">Edit transaction</h1>
      </div>
      {/* An edit voids the original and posts a new id, so the transaction this URL names is gone once it
          saves. The list is where to land — this address would only 404 into its own redirect. */}
      <TransactionCard full initial={tx} onDone={() => void navigate({ to: '/transactions' })} />
    </div>
  );
}
