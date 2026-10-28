import { formatMinor, isoDate } from '@expanses/core';
import { eventPostingOf, jointRowNote, tagTransactions, listPhotos, listTransactions, ownerScope, paidOffMarkOf, setSettledBeforeApp, type TransactionPhotoRow } from '@expanses/db';
import { deleteTransaction } from './member-transfer';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { originHref } from '../../app/from-search';
import { Copy, EyeOff, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BackButton, ROUND } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Sheet } from '../../app/Sheet';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { usePhotoUrls } from '../../photos/use-photo-urls';
import { Card, cx, Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, SwitchRow } from '../../ui/native';
import { showToast } from '../../ui/Toast';
import { useCardsWithArchived } from '../cards/card-queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { usePeopleDebts } from '../debts/queries';
import { useEvents } from '../events/queries';
import { useGoals } from '../goals/queries';
import { usePurchasePayers } from '../sharing/queries';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { classify } from './classify';
import { useChangeable } from './queries';
import { heroCaption, receiptLines, splitParts } from './receipt-view';
import { TransactionCard } from './TransactionCard';
import { useDuplicable } from './duplicable';
import { rowByLine } from '../sharing/JointAccountRows';
import { TwoTapDelete } from './TwoTapDelete';
import { useWithdrawalsUsed } from '../../lib/withdrawal-queries';

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
  const router = useRouter();
  const navigate = useNavigate();
  const phone = usePhone();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  // Removed cards too: a purchase made on one still names it, by its digits.
  const cards = useCardsWithArchived().data ?? [];
  const goals = useGoals().data ?? [];
  const today = isoDate();

  const [editing, setEditing] = useState(false);
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
  // A purchase in a shared workspace (spec §11): who paid, and with what, as the payer's device named it.
  const payerOf = usePurchasePayers(tx ? [tx.id] : [], true);
  const duplicable = useDuplicable(tx ? [tx] : []);
  const urls = usePhotoUrls(photoRows.data ?? []);
  /*
   * The three refusals, asked once for the whole app rather than copied onto every way in: a trade is
   * corrected on its holding's page so its units stay in step, an opening balance and a deleted row have no form that
   * could represent them, and another workspace's row is read-only until that workspace is open. The form
   * route asks the same hook, so the two can never answer differently.
   */
  const { changeable, elsewhere, isTrade, holdingId } = useChangeable(tx);
  // A row of a joint account or card: who recorded it and who changed it.
  const jointNote = useQuery({ queryKey: ['joint-row-note', transactionId], queryFn: () => jointRowNote(database, transactionId) }).data ?? null;
  /*
   * A transaction a shared event put here follows its record (shared events §5, §7): it is changed on the event — Edit
   * opens the expense's own card, or the event for a settle-up — never deleted or copied on its own (the ledger refuses
   * it: EVENT_POSTING), and it says who last changed the record when that was not this phone's person.
   */
  const fromEvent = useQuery({ queryKey: ['event-posting', transactionId], queryFn: () => eventPostingOf(database, transactionId) }).data ?? null;
  // Withdrawal rate §7: the withdrawals a spend from foreign money came from.
  const withdrawal = useWithdrawalsUsed(tx?.id ?? null).data ?? null;
  /*
   * A credit card purchase or refund that can carry the paid-off mark — the same answer the card's statement gives
   * before it offers Paid off — switches it here too, where a tap on the row lands. Null for everything else.
   */
  const paidOffMark = useQuery({ queryKey: ['paid-off-mark', ws.workspaceId, transactionId], queryFn: () => paidOffMarkOf(database, ws, transactionId) }).data ?? null;

  if (receipt.isSuccess && !tx) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Empty>That transaction is not on this device.</Empty>
        <Link to="/transactions" className="text-sm font-medium text-[var(--ph-tint)]">
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
    payer: payerOf(tx.id),
    withdrawal,
    today,
  });

  const caption = heroCaption(tx, kind.amountMinor);
  // One purchase split across workspaces, or with a part Not counted: each part, with the workspace it is counted in.
  const parts = splitParts(tx, accounts, book);

  /*
   * A phone's Edit is the Add screen, opened on this transaction: one full card for every kind of transaction,
   * so correcting one is never a second screen to learn. Back from it comes here again. A desktop keeps the card
   * it has always had, in a sheet, in place — a desktop is not a phone with something taken away, and navigating
   * it off the receipt to a form would be exactly that.
   */
  const edit = () =>
    fromEvent
      ? void navigate(
          fromEvent.kind === 'expense'
            ? { to: '/transactions/new', search: { event: fromEvent.eventId, expense: fromEvent.recordId } }
            : { to: '/events/$eventId', params: { eventId: fromEvent.eventId } },
        )
      : phone
        ? void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId } })
        : setEditing(true);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await deleteTransaction(database, ws, transactionId);
      await invalidate();
      router.history.push(originHref());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Takes the purchase out of its event: it comes back to Cashflow, and the event no longer counts it. */
  async function removeFromEvent() {
    setError(null);
    setBusy(true);
    try {
      await tagTransactions(database, ws, [transactionId], null);
      await invalidate();
      showToast(`Removed from ${(events.data ?? []).find((event) => event.id === tx?.eventId)?.name ?? 'the event'}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** The paid-off mark, on or off: a balancing settlement beside the purchase, so the card still owes what it owed. */
  async function markPaidOff(on: boolean) {
    setError(null);
    setBusy(true);
    try {
      await setSettledBeforeApp(database, ws, transactionId, on);
      // The statement and this receipt both read the mark: every query hears.
      await invalidate();
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
    if (fresh.data?.status === 'void') router.history.push(originHref());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 flex items-center justify-between">
        <BackButton fallback="/transactions" />
        {changeable && (
          <span className="flex items-center gap-2">
            <button type="button" onClick={edit} aria-label="Edit this transaction" className={ROUND}>
              <Pencil size={16} aria-hidden />
            </button>
            {duplicable(tx) && !fromEvent && (
              <button
                type="button"
                onClick={() => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId } })}
                aria-label="Duplicate this transaction"
                className={ROUND}
              >
                <Copy size={16} aria-hidden />
              </button>
            )}
          </span>
        )}
      </div>

      <ErrorBox error={error} />

      <section data-testid="receipt-hero" className="flex flex-col items-center gap-1 text-center">
        <CategoryIcon categoryId={kind.categoryIds[0] ?? null} accounts={accounts} transfer={kind.type === 'transfer' || kind.type === 'opening' || kind.type === 'correction'} size="lg" />
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
        {jointNote && (
          <span data-testid="joint-note" className="text-[13px] text-[var(--ph-ink-3)]">
            {rowByLine({ recordedBy: jointNote.recordedBy, editedBy: jointNote.editedBy, deleted: false, deletedBy: null }, jointNote.me, jointNote.names)}
          </span>
        )}
        {tx.status === 'void' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Deleted</span>}
        {fromEvent && (
          <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="from-event">
            {fromEvent.changedByName ? `Changed by ${fromEvent.changedByName} · ` : ''}
            <Link to="/events/$eventId" params={{ eventId: fromEvent.eventId }} className="font-medium text-[var(--ph-tint)]">
              Open the event
            </Link>
          </p>
        )}
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

      {/* The statement's Paid off, where the row's tap lands: on, the purchase asks nothing of the statement. */}
      {paidOffMark && (
        <InsetGroup wide>
          <SwitchRow label={paidOffMark.refund ? 'Settled' : 'Paid off'} checked={paidOffMark.settled} disabled={busy} onChange={(on) => void markPaidOff(on)} />
        </InsetGroup>
      )}

      {parts.length > 0 && (
        <section data-testid="split-parts" aria-labelledby="split-parts-title" className="flex flex-col gap-1.5">
          <h2 id="split-parts-title" className="px-1 text-[13px] text-[var(--ph-ink-3)]">
            {tx.splitBooks ? 'Split across workspaces' : 'Split'}
          </h2>
          <Card className="divide-y divide-slate-100">
            {parts.map((part, i) => (
              <div
                key={`${part.book?.id ?? 'not-counted'}:${part.categoryId}:${i}`}
                data-testid="split-part"
                data-excluded={part.excluded ? 'true' : undefined}
                className="flex items-center gap-3 py-2 text-sm"
              >
                {/* The workspace's letter on the category's icon, as a list holding several workspaces marks a row. A part
                    Not counted has no category and no workspace: a plain mark in the icon's place. */}
                <span className="relative shrink-0">
                  {part.book || part.categoryId ? (
                    <>
                      <CategoryIcon categoryId={part.categoryId} accounts={accounts} size="sm" />
                      <WorkspaceBadge book={part.book} corner />
                    </>
                  ) : (
                    <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <EyeOff size={14} />
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx('truncate', part.excluded && 'text-slate-500')}>{part.categoryName}</span>
                  <span className="truncate text-xs text-slate-500">
                    {part.book || part.categoryId
                      ? [part.book?.name, part.excluded ? 'Excluded from report' : null].filter(Boolean).join(' · ')
                      : 'In no workspace and no report'}
                  </span>
                </span>
                <span className={cx('tabular text-right', part.excluded && 'text-slate-500 line-through')}>{formatMinor(part.amountMinor, part.currency)}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

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
          {isTrade && holdingId ? (
            /* The row's whole trailing slot, exactly as `TransactionsPage` and `TransactionsTable` replace it. */
            <Link
              to="/net-worth/assets/$accountId"
              params={{ accountId: holdingId }}
              title="Edit this on its holding's page so units stay in step"
              className="min-h-11 py-2 text-sm font-medium text-slate-600 underline"
            >
              Holding
            </Link>
          ) : (
            /* Edit is the round button in the top corner; Delete stays down here, out of a thumb's casual reach. A shared
               event's transaction is deleted on the event, with its record, never here. */
            changeable && !fromEvent && (
              <>
                {tx.eventId && (
                  <InsetGroup>
                    <DestructiveRow calm label="Remove from event" onClick={() => void removeFromEvent()} testId="remove-from-event" />
                  </InsetGroup>
                )}
                <TwoTapDelete busy={busy} onConfirm={() => void remove()} className="self-center" />
              </>
            )
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

      {/* The desktop's Edit: the card, in a sheet, over the receipt. A phone's Edit went to the Add screen above. */}
      {editing && (
        <Sheet grouped title="Edit transaction" onClose={() => void afterEdit()}>
          <TransactionCard initial={tx} onDone={() => void afterEdit()} />
        </Sheet>
      )}
    </div>
  );
}
