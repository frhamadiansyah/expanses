import { useNavigate } from '@tanstack/react-router';
import { BackButton } from '../../app/BackHeader';
import { TransactionCard } from './TransactionCard';

/**
 * `/transactions/new` — the card as a screen.
 *
 * A static segment outranks a dynamic one in this router, so this is matched before `/transactions/$transactionId`
 * and "new" is never read as an id. `add-transaction.spec.ts` asserts exactly that rather than trusting it.
 *
 * There is no `/transactions/$transactionId/edit` beside it. One was written and nothing ever linked to it: a
 * second surface re-stating the three refusals — a trade is corrected on Buy & sell, an opening balance and a
 * deleted row have no form, another workspace's row is read-only — that no user could reach and no test ran.
 * Code that restates a safety rule and is never exercised looks like protection and is not. Editing goes
 * through the receipt's sheet, where all three refusals are asserted. When something needs a route to edit on,
 * it brings the route and the tests with it.
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
