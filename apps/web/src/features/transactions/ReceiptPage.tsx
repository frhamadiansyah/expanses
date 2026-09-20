import { formatMinor, isoDate } from '@expanses/core';
import { listPhotos, listTransactions, ownerScope, type TransactionPhotoRow, voidTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BackButton, ROUND } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Sheet } from '../../app/Sheet';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { usePhotoUrls } from '../../photos/use-photo-urls';
import { Button, Card, cx, Empty, ErrorBox } from '../../ui';
import { useCards } from '../cards/card-queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { usePeopleDebts } from '../debts/queries';
import { useEvents } from '../events/queries';
import { useGoals } from '../goals/queries';
import { useAssetValues } from '../networth/queries';
import { useWorkspaceBadges } from '../workspaces/queries';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { classify } from './classify';
import { ConvertForm } from './ConvertForm';
import { EditSheet } from './EditSheet';
import { useChangeable } from './queries';
import { heroCaption, receiptLines } from './receipt-view';
import { TransactionCard } from './TransactionCard';
import { canEditInSheet } from './tx-form';
import { TwoTapDelete } from './TwoTapDelete';

const route = getRouteApi('/transactions/$transactionId');

/** "Thursday, 17 September 2026" — the long form, because a receipt is read once and has the room. */
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function ReceiptRoute() {
  const { transactionId } = route.useParams();
  return <ReceiptPage transactionId={transactionId} />;
}

/**
 * One transaction, whole: what it was, what it cost, what it earned, who owes what, and the pictures kept with
 * it. Reached by an ⓘ on a desktop and, from Task 9, by tapping the row on a phone.
 *
 * It reads owner-wide on purpose. An account's history is the owner's, not a workspace's, so a receipt must open
 * whatever workspace its transaction was filed in — and `includeVoid` so a deleted row, which the list still
 * shows under Show deleted, can still be opened and read.
 */
export function ReceiptPage({ transactionId }: { transactionId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const phone = usePhone();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const cards = useCards().data ?? [];
  const goals = useGoals().data ?? [];
  const holdings = (useAssetValues().data ?? []).filter((row) => row.mode === 'market');
  const today = isoDate();

  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const receipt = useQuery({
    queryKey: ['receipt', ws.workspaceId, transactionId],
    queryFn: async () => (await listTransactions(database, ownerScope(ws), { id: transactionId, includeVoid: true }))[0] ?? null,
  });
  const tx = receipt.data ?? null;

  const points = useQuery({
    queryKey: ['receipt-points', ws.workspaceId, transactionId],
    enabled: tx !== null && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, [tx!], accounts),
  });
  // Both through the hooks that already own these cache keys. A second `useQuery` on ['events', …] here would
  // be the same key holding a workspace-narrowed list, and whichever screen mounted first would decide what the
  // other one saw — an event read owner-wide, as `useEvents` reads it, is the one that is right.
  const debts = usePeopleDebts(today);
  const events = useEvents();
  const photoRows = useQuery({ queryKey: ['photos', ws.workspaceId, transactionId], queryFn: () => listPhotos(database, ws, transactionId) });
  const badges = useWorkspaceBadges(tx ? [tx.id] : []);
  const urls = usePhotoUrls(photoRows.data ?? []);
  /*
   * The three refusals, asked once for the whole app rather than copied onto every way in: a trade is
   * corrected on Buy & sell so its units stay in step, an opening balance and a deleted row have no form that
   * could represent them, and another workspace's row is read-only until that workspace is open. The form
   * route asks the same hook, so the two can never answer differently.
   */
  const { changeable, elsewhere, isTrade } = useChangeable(tx);

  if (receipt.isSuccess && !tx) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Empty>That transaction is not on this device.</Empty>
        <Link to="/transactions" className="text-sm font-medium text-emerald-800">
          Back to Transactions
        </Link>
      </div>
    );
  }
  if (!tx) return <ErrorBox error={receipt.error} />;

  const kind = classify(tx);
  const categoryNames = kind.categoryIds.map((id) => accounts.find((account) => account.id === id)?.name).filter(Boolean);
  const book = badges.of(tx.id);
  // Who owes what on *this* transaction: its own debt entries, named by the person each debt account belongs to.
  const personByAccount = new Map(
    [...(debts.data?.owedToYou ?? []), ...(debts.data?.settled ?? [])].flatMap((person) => person.loans.map((loan) => [loan.accountId, person.personName] as const)),
  );
  const owed = tx.entries
    .filter((entry) => entry.amountMinor > 0 && personByAccount.has(entry.accountId))
    .map((entry) => ({ personName: personByAccount.get(entry.accountId)!, totalMinor: entry.amountMinor }));

  const lines = receiptLines({
    tx,
    accounts,
    cards,
    currency: ws.baseCurrency,
    points: points.data?.[tx.id] ?? null,
    owed,
    eventName: (events.data ?? []).find((event) => event.id === tx.eventId)?.name,
    goalName: goals.find((goal) => goal.id === tx.goalId)?.name,
  });

  const caption = heroCaption(tx, kind.amountMinor);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await voidTransaction(database, ws, transactionId);
      await invalidate();
      await navigate({ to: '/transactions' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * An edit replaces the transaction: the original is voided and a new one posted under a new id. So when the
   * form leaves this one void the receipt it belonged to is gone, and the list is where to land. Cancelling
   * leaves it posted, and the receipt simply stays open.
   */
  async function afterEdit() {
    setEditing(false);
    const fresh = await receipt.refetch();
    if (fresh.data?.status === 'void') await navigate({ to: '/transactions' });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 flex items-center justify-between">
        <BackButton fallback="/transactions" />
        {changeable && (
          <button type="button" onClick={() => setEditing(true)} aria-label="Edit this transaction" className={ROUND}>
            <Pencil size={16} aria-hidden />
          </button>
        )}
      </div>

      <ErrorBox error={error} />

      <section data-testid="receipt-hero" className="flex flex-col items-center gap-1 text-center">
        <CategoryIcon categoryId={kind.categoryIds[0] ?? null} accounts={accounts} transfer={kind.type === 'transfer' || kind.type === 'opening'} size="lg" />
        <span data-testid="hero-amount" className={cx('tabular text-3xl font-semibold', tx.status === 'void' && 'text-slate-400 line-through')}>
          {formatMinor(kind.amountMinor, kind.currency)}
        </span>
        {/* Which of the two figures this is, when the bill and the share of it are not the same number. */}
        {caption && <span className="text-xs text-slate-500">{caption}</span>}
        <h1 className="text-lg font-semibold">{tx.description}</h1>
        <span className="text-sm text-slate-500">
          {[...categoryNames, book?.name].filter(Boolean).join(' · ')}
        </span>
        <span className="text-sm text-slate-500">{longDate(tx.occurredOn)}</span>
        {tx.status === 'void' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Deleted</span>}
        {tx.excluded && (
          <p data-testid="excluded-note" className="max-w-sm text-xs text-slate-500">
            Excluded from the chart and budgets. Still counted in balances, statements and points.
          </p>
        )}
      </section>

      <Card className="divide-y divide-slate-100">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-4 py-2 text-sm">
            <span className="text-slate-500">{line.label}</span>
            <span className={cx('tabular text-right', line.tone === 'points' && 'font-medium text-emerald-700')}>{line.value}</span>
          </div>
        ))}
      </Card>

      {(photoRows.data ?? []).length > 0 && (
        <div data-testid="photo-strip" className="flex gap-2 overflow-x-auto">
          {(photoRows.data ?? []).map((row) =>
            urls[row.fileName] ? (
              // Tapped to see it full size, the same promise the Photos sheet makes while it is being attached.
              <button
                key={row.id}
                type="button"
                onClick={() => setViewing(row)}
                className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
              >
                <img src={urls[row.fileName]} alt={`Receipt photo for ${tx.description}`} className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200" />
              </button>
            ) : (
              <div key={row.id} className="h-24 w-24 shrink-0 rounded-xl bg-slate-100" aria-hidden />
            ),
          )}
        </div>
      )}

      {elsewhere ? (
        <SwitchToEdit book={elsewhere} className="self-center text-center" />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {isTrade ? (
            /* The row's whole trailing slot, exactly as `TransactionsPage` and `TransactionsTable` replace it. */
            <Link to="/net-worth/trades" title="Edit this on Buy & sell so units stay in step" className="min-h-11 py-2 text-sm font-medium text-slate-600 underline">
              Buy &amp; sell
            </Link>
          ) : (
            <>
              {tx.status === 'posted' && kind.type === 'expense' && holdings.length > 0 && (
                <button type="button" onClick={() => setConverting(true)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  This was a purchase
                </button>
              )}
              {changeable && (
                <>
                  <Button variant="ghost" className="min-h-11" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  {/* Gated on the same condition as Edit: what cannot be corrected here must not be deleted here. */}
                  <TwoTapDelete busy={busy} onConfirm={() => void remove()} className="self-center" />
                </>
              )}
            </>
          )}
        </div>
      )}

      {viewing && (
        <Sheet title="Photo" onClose={() => setViewing(null)}>
          {urls[viewing.fileName] ? (
            <img src={urls[viewing.fileName]} alt={`Receipt photo for ${tx.description}`} className="mx-auto max-h-[70dvh] w-auto rounded-xl" />
          ) : (
            <p className="text-sm text-slate-500">That picture is not on this device.</p>
          )}
        </Sheet>
      )}

      {/*
        The phone's Edit is the sheet; the desktop's is the card it has always been, in a sheet, in place. A
        desktop is not a phone with something taken away, and navigating it off the receipt to a form would be
        exactly that. What the sheet cannot hold — a split, a transfer, a foreign purchase — opens the full card
        on a phone too, because `canEditInSheet` says so and the fallback is the caller's to choose.
      */}
      {editing &&
        (phone && canEditInSheet(tx) ? (
          <EditSheet tx={tx} onClose={() => void afterEdit()} />
        ) : (
          <Sheet title="Edit transaction" onClose={() => void afterEdit()}>
            <TransactionCard initial={tx} onDone={() => void afterEdit()} />
          </Sheet>
        ))}

      {converting && (
        <Sheet title="This was a purchase" onClose={() => setConverting(false)}>
          <ConvertForm
            tx={tx}
            holdings={holdings.map((holding) => ({ accountId: holding.accountId, name: holding.name }))}
            goals={goals.map((goal) => ({ id: goal.id, name: goal.name }))}
            onDone={() => setConverting(false)}
          />
        </Sheet>
      )}
    </div>
  );
}
