import { listTransactions, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { useChangeable } from './queries';
import { TransactionCard } from './TransactionCard';

const editRoute = getRouteApi('/transactions/$transactionId/edit');

const ROUND = 'flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70 focus-visible:outline-2 focus-visible:outline-slate-900';

/** The card on a page of its own, with the way back a screen owes its user. */
function Page({ title, children }: { title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const back = () => {
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: '/transactions' });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={back} aria-label="Back" className={ROUND}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      {children}
    </div>
  );
}

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
    <Page title="Add a transaction">
      <TransactionCard full onDone={done} />
    </Page>
  );
}

/**
 * `/transactions/$transactionId/edit` — the same card, holding a transaction that already exists.
 *
 * It inherits every refusal the list and the receipt carry, through the one hook all three ask: a trade is
 * corrected on Buy & sell so its units stay in step, an opening balance and a deleted row have no form that
 * could represent them, and a row filed in another workspace is read-only until that workspace is open.
 * A new way in that skipped any of them would be a way round it.
 */
export function EditTransactionRoute() {
  const { transactionId } = editRoute.useParams();
  const { database, ws } = useApp();
  const navigate = useNavigate();
  // Owner-wide and including void, exactly as the receipt reads it: what may not be edited still has to be found
  // before it can be refused, or every refusal below would read as "not on this device".
  const found = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = found.data ?? null;
  const { changeable, elsewhere, isTrade } = useChangeable(tx);

  if (found.isSuccess && !tx) {
    return (
      <Page title="Edit transaction">
        <Empty>That transaction is not on this device.</Empty>
        <Link to="/transactions" className="text-sm font-medium text-emerald-800">
          Back to Transactions
        </Link>
      </Page>
    );
  }
  if (!tx) return <ErrorBox error={found.error} />;
  if (!changeable) {
    return (
      <Page title="Edit transaction">
        {elsewhere ? (
          <SwitchToEdit book={elsewhere} />
        ) : isTrade ? (
          <p className="text-sm text-slate-600">
            This is a purchase of units.{' '}
            <Link to="/net-worth/trades" className="font-medium underline">
              Edit it on Buy &amp; sell
            </Link>{' '}
            so the units stay in step.
          </p>
        ) : (
          <p className="text-sm text-slate-600">This transaction cannot be edited.</p>
        )}
      </Page>
    );
  }

  return (
    <Page title="Edit transaction">
      <TransactionCard full initial={tx} onDone={() => void navigate({ to: '/transactions' })} />
    </Page>
  );
}
