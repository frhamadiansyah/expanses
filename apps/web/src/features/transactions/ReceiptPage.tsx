import { formatMinor } from '@expanses/core';
import type { AccountRow, TransactionPhotoRow } from '@expanses/db';
import { deletedCopyLine } from '../events/delete-copy';
import { getRouteApi, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { originHref } from '../../app/from-search';
import { Copy, EyeOff, Pencil } from 'lucide-react';
import { useState } from 'react';
import { BackButton, ROUND } from '../../app/BackHeader';
import { usePhone } from '../../app/use-phone';
import { Sheet } from '../../app/Sheet';
import { useAccounts } from '../../lib/queries';
import { Card, cx, Empty, ErrorBox } from '../../ui';
import { DestructiveRow, GROUP_GAP, InsetGroup, InsetRow, SwitchRow } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { isCorrection } from './draft';
import { instalmentRowValue } from './turn-into';
import { TurnIntoSheet } from './TurnIntoSheet';
import { TransactionCard } from './TransactionCard';
import { rowByLine } from '../sharing/JointAccountRows';
import { TwoTapDelete } from './TwoTapDelete';
import { useReceipt } from './use-receipt';
import type { SplitPart } from './receipt-view';

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
  const router = useRouter();
  const navigate = useNavigate();
  const phone = usePhone();
  const accounts = useAccounts().data ?? [];

  const [editing, setEditing] = useState(false);
  // Turn into instalments (option A): the sheet, open or not.
  const [turning, setTurning] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);

  const { receipt, tx, view, busy, error, remove, removeFromEvent, markPaidOff, photos, urls, jointNote, fromEvent, onEvent, paidOffMark, bill, changeable, elsewhere, isTrade, holdingId } = useReceipt(transactionId, {
    onDeleted: () => router.history.push(originHref()),
    onReplaced: (standing) => void navigate({ to: '/transactions/$transactionId', params: { transactionId: standing }, replace: true }),
  });

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
  if (!tx || !view) return <ErrorBox error={receipt.error} />;

  const { kind, categoryNames, book, lines, billRow, openBill, caption, plan, instalmentCard, spread, parts } = view;

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
            {/* A deleted copy's transaction has no event left to change it on, and the ledger refuses it alone. */}
            {!fromEvent?.deletedHere && (
              <button type="button" onClick={edit} aria-label="Edit this transaction" className={ROUND}>
                <Pencil size={16} aria-hidden />
              </button>
            )}
            {view.duplicable && (
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
        {/* Spread by its plan: the purchase counts a month at a time (card instalments C). */}
        {spread && (
          <span data-testid="spread-caption" className="text-xs text-slate-500">
            {spread}
          </span>
        )}
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
            {fromEvent.deletedHere ? (
              deletedCopyLine(fromEvent.eventName)
            ) : (
              <>
                {fromEvent.changedByName ? `Changed by ${fromEvent.changedByName} · ` : ''}
                <Link to="/events/$eventId" params={{ eventId: fromEvent.eventId }} className="font-medium text-[var(--ph-tint)]">
                  Open the event
                </Link>
              </>
            )}
          </p>
        )}
        {onEvent && (
          <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="on-event">
            {`On ${onEvent.eventName ?? 'a shared event'}, not counted`}
            {onEvent.eventId ? (
              <>
                {' · '}
                <Link to="/events/$eventId" params={{ eventId: onEvent.eventId }} className="font-medium text-[var(--ph-tint)]">
                  Open the event
                </Link>
              </>
            ) : null}
          </p>
        )}
        {tx.excluded && (
          <p data-testid="excluded-note" className="max-w-sm text-xs text-slate-500">
            {tx.feeLeftOut
              ? 'Annual fee reversed: the fee and its reversal are left out of the chart and budgets. Still counted in balances and statements.'
              : 'Excluded from the chart and budgets. Still counted in balances, statements and points.'}
          </p>
        )}
      </section>

      {/* Every group from here down sits one group's gap from the next: an InsetGroup brings its own, the rest are given it. */}
      <div data-testid="receipt-groups" className="flex flex-col">
        <div style={{ marginBottom: GROUP_GAP }}>
          <Card className="divide-y divide-slate-100">
            {lines.map((line) => (
              <div key={line.label} className="flex justify-between gap-4 py-2 text-sm">
                <span className="text-slate-500">{line.label}</span>
                <span className={cx('tabular text-right', line.tone === 'points' && 'font-medium text-emerald-700')}>
                  {line.detail ? (
                    <>
                      <span className="block">{line.value}</span>
                      <span className="block text-[13px] text-slate-500">{line.detail}</span>
                    </>
                  ) : (
                    line.value
                  )}
                </span>
              </div>
            ))}
          </Card>
        </div>

        {/*
         * The bill this settles a month of, and the statement's Paid off, in one group. Bill reads Linked or None, and a
         * tap opens the bill list (to link one, move it or let it go) — or the bill itself, for Pay's own payment. Paid
         * off is the switch the statement offers, where the row's tap lands: on, the purchase asks nothing of the statement.
         */}
        {(billRow || paidOffMark) && (
          <InsetGroup>
            {billRow && (
              <InsetRow title="Bill" value={bill ? 'Linked' : 'None'} valueTone={bill ? 'ink-2' : 'ink-3'} chevron testId="receipt-bill" onClick={openBill} />
            )}
            {paidOffMark && (
              <SwitchRow label={paidOffMark.refund ? 'Settled' : 'Paid off'} checked={paidOffMark.settled} disabled={busy} onChange={(on) => void markPaidOff(on)} />
            )}
          </InsetGroup>
        )}

        {/*
         * Turn into instalments (owner, 16 Nov 2026, option A): None opens the sheet; a plan already tied to the purchase
         * opens the plan's page, where its months, what is paid and how it counts are.
         */}
        {(plan || instalmentCard) && (
          <InsetGroup>
            <InsetRow
              title="Instalments"
              value={instalmentRowValue(plan, kind.currency)}
              valueTone={plan ? 'ink-2' : 'ink-3'}
              chevron
              testId="receipt-instalments"
              onClick={() =>
                plan
                  ? void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: plan.cardAccountId, planId: plan.id } })
                  : setTurning(true)
              }
            />
          </InsetGroup>
        )}
        {turning && instalmentCard && (
          <TurnIntoSheet
            purchase={{ transactionId: tx.id, description: tx.description, occurredOn: tx.occurredOn, amountMinor: instalmentCard.amountMinor }}
            card={{ accountId: instalmentCard.cardAccountId, name: accounts.find((a) => a.id === instalmentCard.cardAccountId)?.name ?? '' }}
            currency={accounts.find((a) => a.id === instalmentCard.cardAccountId)?.currency ?? kind.currency}
            investment={isTrade}
            onClose={() => setTurning(false)}
          />
        )}

        {/* A past purchase on a money account: read here, changed on its form. */}
        {tx.past && tx.status === 'posted' && (
          <InsetGroup>
            <InsetRow title="Past purchase" value="Balance unchanged" chevron={false} testId="receipt-past" />
          </InsetGroup>
        )}

        {parts.length > 0 && (
          <section data-testid="split-parts" aria-labelledby="split-parts-title" className="flex flex-col gap-1.5" style={{ marginBottom: GROUP_GAP }}>
            <h2 id="split-parts-title" className="px-1 text-[13px] text-[var(--ph-ink-3)]">
              {tx.splitBooks ? 'Split across workspaces' : 'Split'}
            </h2>
            <Card className="divide-y divide-slate-100">
              {parts.map((part, i) => (
                <SplitPartLine key={`${part.book?.id ?? 'not-counted'}:${part.categoryId}:${i}`} part={part} accounts={accounts} />
              ))}
            </Card>
          </section>
        )}

        {photos.length > 0 && (
          <div data-testid="photo-strip" className="flex gap-2 overflow-x-auto" style={{ marginBottom: GROUP_GAP }}>
            {photos.map((row) =>
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

        {/* A transfer listed on a shared event is taken off it whatever workspace is open: it acts on its own workspace's
            row, and a workspace no longer shared refuses it in words (the error above). */}
        {onEvent && tx.status === 'posted' && (
          <InsetGroup>
            <DestructiveRow calm label="Remove from event" onClick={() => void removeFromEvent()} testId="remove-from-event" />
          </InsetGroup>
        )}
        {elsewhere ? (
          <SwitchToEdit book={elsewhere} className="self-center text-center" />
        ) : (
          <div className="flex flex-col items-center">
            {isTrade && holdingId ? (
              /* A trade is edited on its holding's page, so units stay in step: the receipt's one way there. */
              <InsetGroup className="w-full">
                <InsetRow action title={<span className="text-[var(--ph-tint)]">Open holding</span>} label="Open holding" testId="open-holding" onClick={() => void navigate({ to: '/net-worth/assets/$accountId', params: { accountId: holdingId } })} />
              </InsetGroup>
            ) : (
              /* Edit is the round button in the top corner; Delete stays down here, out of a thumb's casual reach. A shared
                 event's transaction is deleted on the event, with its record, never here. */
              (changeable || (isCorrection(tx) && !isTrade && !elsewhere)) && !fromEvent && (
                <>
                  {tx.eventId && !onEvent && (
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
      </div>

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

/**
 * One part of a split purchase: its category's icon with the workspace's letter on it (or a plain mark for a part Not
 * counted), its category and workspace, and what it came to. The phone's receipt and the Mac's receipt peek list them alike.
 */
export function SplitPartLine({ part, accounts, className = 'flex items-center gap-3 py-2 text-sm' }: { part: SplitPart; accounts: readonly AccountRow[]; className?: string }) {
  return (
    <div
      data-testid="split-part"
      data-excluded={part.excluded ? 'true' : undefined}
      className={className}
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
  );
}
