import type { TransactionPhotoRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox } from '../../ui';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { useTwoTap } from '../../ui/two-tap';
import { CategoryIcon } from '../categories/CategoryIcon';
import { deletedCopyLine } from '../events/delete-copy';
import { useResolvedNeeds } from '../essential-split/queries';
import { rowByLine } from '../sharing/JointAccountRows';
import { useOpenBookReadOnly } from '../sharing/queries';
import { useOpenBook } from '../workspaces/queries';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { countsAs } from './cashflow-desk-model';
import { SplitPartLine } from './ReceiptPage';
import { kindWord, type PeekLine, peekFigure, receiptPeekLines } from './receipt-peek-model';
import { instalmentRowValue } from './turn-into';
import { TurnIntoSheet } from './TurnIntoSheet';
import { type Receipt, useReceipt } from './use-receipt';
import { YEARLY_BILL_LINE } from './yearly-bills';

/** "Wed 11 Nov 2026". */
const peekDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Delete asks twice, in place, as the receipt's does: the state dies with the button. */
function DeletePeek({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  return (
    <button
      type="button"
      disabled={busy}
      onBlur={onBlur}
      onClick={onClick}
      aria-label={armed ? 'Click again to delete' : 'Delete this transaction'}
      className={cx(
        'rounded-[6px] border px-3 py-[4px] text-[13px] disabled:opacity-40',
        armed ? 'border-[var(--ph-alarm)] bg-[var(--ph-alarm)] text-white' : 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-alarm)] hover:bg-[var(--ph-fill)]',
      )}
    >
      {armed ? 'Click again to delete' : 'Delete'}
    </button>
  );
}

/** One row of the peek: label and value, a click target when the receipt's row is one (Bill, Instalments), Paid off a switch. */
export function PeekRow({ line, onAction, busy }: { line: PeekLine; onAction?: (action: NonNullable<PeekLine['action']>) => void; busy?: boolean }) {
  const value = (
    <>
      <span className="block">{line.value}</span>
      {line.detail && <span className="block text-[12px] text-[var(--ph-ink-3)]">{line.detail}</span>}
    </>
  );
  const tone = line.tone === 'muted' ? 'text-[var(--ph-ink-3)]' : line.tone === 'points' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]';
  const shell = 'flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px] first:border-t-0';
  const label = <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">{line.label}</dt>;
  if (line.action === 'paid-off') {
    return (
      <div className={shell} data-testid={line.testId}>
        {label}
        <dd className="min-w-0 flex-1">
          <input type="checkbox" role="switch" aria-label={line.label} checked={line.on ?? false} disabled={busy} onChange={() => onAction?.('paid-off')} className="accent-[var(--mac-accent)]" />
        </dd>
      </div>
    );
  }
  if (line.action && onAction) {
    return (
      <div className={shell}>
        {label}
        <dd className="min-w-0 flex-1">
          <button type="button" data-testid={line.testId} onClick={() => onAction(line.action!)} aria-label={`${line.label}, ${line.value}`} className="w-full text-left break-words text-[var(--mac-accent)] hover:underline">
            {value}
          </button>
        </dd>
      </div>
    );
  }
  return (
    <div className={shell} data-testid={line.testId}>
      {label}
      <dd className={cx('min-w-0 flex-1 break-words tabular-nums', tone)}>{value}</dd>
    </div>
  );
}

/**
 * The Mac receipt: the side peek a transaction opens on a wide screen — Cashflow's rows, and every other desk page that
 * opens a transaction. It reads the phone receipt's own hook (`useReceipt`), so it says every line the phone receipt
 * says, in its order and by its rules, and can do what it can: Bill, Paid off, Instalments (Turn into, or the plan),
 * the split parts, the pictures, Remove from event, Open holding — and Edit (Edit payment, for a card payment),
 * Duplicate, Split and Delete, each only where the receipt would offer it. A row that cannot be changed here (a trade,
 * another workspace's, a share that ended) reads the same, with why and where instead of the buttons.
 */
export function ReceiptPeek({
  transactionId,
  top = 52,
  testId = 'cashflow-peek',
  first,
  last,
  onStep,
  onClose,
  back,
  onReplaced,
  yearlyOut = false,
}: {
  transactionId: string;
  /** Cashflow's month leaves this yearly bill's payment out of its figures (`leaveOutYearlyBills`): the peek says so, with the bill. */
  yearlyOut?: boolean;
  top?: number;
  testId?: string;
  first?: boolean;
  last?: boolean;
  onStep?: (by: -1 | 1) => void;
  onClose: () => void;
  back?: { label: string; onBack: () => void };
  /** The row went back onto the transfer it was split from (Remove from event): the peek follows it, or closes. */
  onReplaced?: (transactionId: string) => void;
}) {
  const receipt = useReceipt(transactionId, { onDeleted: onClose, onReplaced: onReplaced ?? (() => onClose()) });
  const { tx, view, setError } = receipt;
  // A step to another row starts clean: an error belonged to the row it was made on.
  useEffect(() => setError(null), [transactionId]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = tx ? tx.description || (view ? (kindWord(view.kind.type) ?? view.categoryNames.join(', ')) : '') || 'Transaction' : '';
  return (
    <SidePeek top={top} label="Transaction details" testId={testId} title={title} titleTestId="peek-title" noun="transaction" first={first} last={last} onStep={onStep} onClose={onClose} back={back}>
      {receipt.receipt.isSuccess && !tx ? (
        <p className="px-[14px] py-2 text-[13px] text-[var(--ph-ink-3)]">That transaction is not on this device.</p>
      ) : tx && view ? (
        <PeekBody key={transactionId} receipt={receipt} yearlyOut={yearlyOut} />
      ) : (
        <ErrorBox error={receipt.receipt.error} />
      )}
    </SidePeek>
  );
}

function PeekBody({ receipt, yearlyOut }: { receipt: Receipt; yearlyOut: boolean }) {
  const navigate = useNavigate();
  const needs = useResolvedNeeds().data;
  const openBook = useOpenBook();
  const readOnly = useOpenBookReadOnly();
  const [turning, setTurning] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);
  const { tx, view, accounts, busy, error, photos, urls, jointNote, fromEvent, onEvent, paidOffMark, bill, elsewhere, isTrade, holdingId } = receipt;
  if (!tx || !view) return null;
  const { kind, categoryNames, book, plan, instalmentCard } = view;
  const transactionId = tx.id;
  const figure = peekFigure(kind);
  const word = kindWord(kind.type);
  const counts = kind.type === 'expense' && kind.categoryIds[0] ? countsAs({ type: 'expense', categoryId: kind.categoryIds[0] }, needs) : '';

  const lines = receiptPeekLines({
    // A transfer, an opening balance, a correction read as what they are; a transfer's fee is not its category.
    category: word ?? (categoryNames.join(', ') || 'Uncategorised'),
    lines: view.lines,
    countsAs: counts && counts !== '—' ? counts : null,
    workspace: book?.name ?? openBook?.name ?? null,
    bill: view.billRow ? (bill ? 'Linked' : 'None') : null,
    paidOff: paidOffMark ? { label: paidOffMark.refund ? 'Settled' : 'Paid off', on: paidOffMark.settled } : null,
    instalments: plan || instalmentCard ? instalmentRowValue(plan, kind.currency) : null,
    past: !!tx.past && tx.status === 'posted',
  });

  const act = (action: NonNullable<PeekLine['action']>) => {
    if (action === 'bill') view.openBill();
    else if (action === 'paid-off') void receipt.markPaidOff(!(paidOffMark?.settled ?? false));
    else if (plan) void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: plan.cardAccountId, planId: plan.id } });
    else setTurning(true);
  };

  // Edit is the full edit screen, as a double-click on Cashflow's row opens it; a shared event's row is changed on the event.
  const edit = () =>
    fromEvent
      ? void navigate(
          fromEvent.kind === 'expense'
            ? { to: '/transactions/new', search: { event: fromEvent.eventId, expense: fromEvent.recordId } }
            : { to: '/events/$eventId', params: { eventId: fromEvent.eventId } },
        )
      : void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId } });
  const split = () => void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId }, search: { split: true } });
  const splittable = view.editable && !fromEvent && kind.type === 'expense' && !tx.originalCurrency && !view.cardPayment;
  // Remove from event: a transfer listed on a shared event, or a purchase in an event this receipt may change.
  const removable = (onEvent && tx.status === 'posted') || (view.deletable && !!tx.eventId && !onEvent);
  // Why nothing here changes it, and where it can be.
  const notice = elsewhere ? (
    <SwitchToEdit book={elsewhere} />
  ) : isTrade && holdingId ? (
    'A trade is changed on its holding’s page.'
  ) : readOnly ? (
    'This share has ended: nothing here is changed.'
  ) : null;
  const anyButton = view.editable || view.duplicable || splittable || removable || view.deletable;

  return (
    <>
      <div className="px-[14px] pb-[10px]">
        <div data-testid="peek-amount" className={cx('text-[22px] font-semibold tabular-nums', tx.status === 'void' ? 'text-[var(--ph-ink-3)] line-through' : figure.income ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>
          {figure.text}
        </div>
        {/* Which of the two figures this is, when the bill and the share of it are not the same number. */}
        {view.caption && <div className="text-[12px] text-[var(--ph-ink-3)]">{view.caption}</div>}
        {/* Spread by its plan: the purchase counts a month at a time (card instalments C). */}
        {view.spread && (
          <div data-testid="spread-caption" className="text-[12px] text-[var(--ph-ink-3)]">
            {view.spread}
          </div>
        )}
        <div className="mt-[2px] text-[13px] text-[var(--ph-ink-3)]">{peekDate(tx.occurredOn)}</div>
        {/* Left out of the month's figures, as its row says: which bill, and that the year counts it. */}
        {yearlyOut && (
          <div data-testid="yearly-note" className="mt-[2px] text-[12px] text-[var(--ph-ink-3)]">
            {bill ? `${bill.name} · ` : ''}
            {YEARLY_BILL_LINE}
          </div>
        )}
        {jointNote && (
          <div data-testid="joint-note" className="mt-[2px] text-[12px] text-[var(--ph-ink-3)]">
            {rowByLine({ recordedBy: jointNote.recordedBy, editedBy: jointNote.editedBy, deleted: false, deletedBy: null }, jointNote.me, jointNote.names)}
          </div>
        )}
        {tx.status === 'void' && <span className="mt-1 inline-block rounded-full bg-[var(--ph-fill)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ph-ink-2)]">Deleted</span>}
        {fromEvent && (
          <p data-testid="from-event" className="mt-1 text-[12px] text-[var(--ph-ink-3)]">
            {fromEvent.deletedHere ? (
              deletedCopyLine(fromEvent.eventName)
            ) : (
              <>
                {fromEvent.changedByName ? `Changed by ${fromEvent.changedByName} · ` : ''}
                <Link to="/events/$eventId" params={{ eventId: fromEvent.eventId }} className="text-[var(--mac-accent)] hover:underline">
                  Open the event
                </Link>
              </>
            )}
          </p>
        )}
        {onEvent && (
          <p data-testid="on-event" className="mt-1 text-[12px] text-[var(--ph-ink-3)]">
            {`On ${onEvent.eventName ?? 'a shared event'}, not counted`}
            {onEvent.eventId ? (
              <>
                {' · '}
                <Link to="/events/$eventId" params={{ eventId: onEvent.eventId }} className="text-[var(--mac-accent)] hover:underline">
                  Open the event
                </Link>
              </>
            ) : null}
          </p>
        )}
        {tx.excluded && (
          <p data-testid="excluded-note" className="mt-1 text-[12px] text-[var(--ph-ink-3)]">
            Excluded from the chart and budgets. Still counted in balances, statements and points.
          </p>
        )}
      </div>

      <dl className="border-t border-[var(--ph-hair)]">
        {lines.map((line) =>
          line.key === 'category' ? (
            <div key={line.key} className="flex px-3 py-2 text-[13px]">
              <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">{line.label}</dt>
              <dd className="flex min-w-0 flex-1 items-center gap-[6px] text-[var(--ph-ink)]">
                <CategoryIcon categoryId={word ? null : (kind.categoryIds[0] ?? null)} accounts={accounts} transfer={word !== null} size="xs" />
                <span className="min-w-0 break-words">{line.value}</span>
              </dd>
            </div>
          ) : (
            <PeekRow key={line.key} line={line} onAction={act} busy={busy} />
          ),
        )}
        {/* The pictures kept with it: a click shows one whole. None, and a row that can be changed is offered one. */}
        <div className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px]">
          <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">Receipt</dt>
          <dd className="min-w-0 flex-1 text-[var(--ph-ink-3)]">
            {photos.length > 0 ? (
              <div data-testid="photo-strip" className="flex flex-wrap gap-[6px]">
                {photos.map((row) =>
                  urls[row.fileName] ? (
                    <button key={row.id} type="button" onClick={() => setViewing(row)} className="rounded-[6px] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]">
                      <img src={urls[row.fileName]} alt={`Receipt photo for ${tx.description}`} className="h-[56px] w-[56px] rounded-[6px] object-cover ring-1 ring-[var(--ph-hair)]" />
                    </button>
                  ) : (
                    <div key={row.id} className="h-[56px] w-[56px] rounded-[6px] bg-[var(--ph-fill)]" aria-hidden />
                  ),
                )}
              </div>
            ) : view.editable && !fromEvent ? (
              <>
                No photo ·{' '}
                <Link to="/transactions/$transactionId/edit" params={{ transactionId }} className="text-[var(--mac-accent)] hover:underline">
                  Add
                </Link>
              </>
            ) : (
              'No photo'
            )}
          </dd>
        </div>
      </dl>

      {view.parts.length > 0 && (
        <section data-testid="split-parts" aria-labelledby="peek-split-title" className="border-t border-[var(--ph-hair)] px-3 pt-[8px]">
          <h3 id="peek-split-title" className="text-[11px] font-semibold text-[var(--ph-ink-3)]">
            {tx.splitBooks ? 'Split across workspaces' : 'Split'}
          </h3>
          {view.parts.map((part, i) => (
            <SplitPartLine
              key={`${part.book?.id ?? 'not-counted'}:${part.categoryId}:${i}`}
              part={part}
              accounts={accounts}
              className="flex items-center gap-[8px] py-[5px] text-[13px] text-[var(--ph-ink)] [&_.text-slate-500]:text-[var(--ph-ink-3)] [&_.text-xs]:text-[11.5px]"
            />
          ))}
        </section>
      )}

      {notice && (
        <div data-testid="peek-notice" className="border-t border-[var(--ph-hair)] px-[14px] pt-[10px] text-[12px] text-[var(--ph-ink-3)] [&_.text-xs]:text-[12px]">
          {notice}
        </div>
      )}
      {error ? (
        <div className="px-[14px] pt-[10px]">
          <ErrorBox error={error} />
        </div>
      ) : null}
      {(anyButton || (isTrade && holdingId)) && (
        <div className="flex flex-wrap gap-2 px-[14px] pt-[14px] pb-3">
          {/* A trade is edited on its holding's page, so units stay in step: the receipt's one way there. */}
          {isTrade && holdingId && !elsewhere && (
            <button type="button" data-testid="open-holding" className={PEEK_BUTTON} onClick={() => void navigate({ to: '/net-worth/assets/$accountId', params: { accountId: holdingId } })}>
              Open holding
            </button>
          )}
          {view.editable && (
            <button type="button" className={PEEK_BUTTON} disabled={busy} onClick={edit}>
              {view.cardPayment ? 'Edit payment' : 'Edit'}
            </button>
          )}
          {view.duplicable && (
            <button type="button" className={PEEK_BUTTON} disabled={busy} onClick={() => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId } })}>
              Duplicate
            </button>
          )}
          {splittable && (
            <button type="button" className={PEEK_BUTTON} disabled={busy} onClick={split}>
              Split
            </button>
          )}
          {removable && (
            <button type="button" data-testid="remove-from-event" className={PEEK_BUTTON} disabled={busy} onClick={() => void receipt.removeFromEvent()}>
              Remove from event
            </button>
          )}
          {view.deletable && <DeletePeek busy={busy} onConfirm={() => void receipt.remove()} />}
        </div>
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
      {viewing && (
        <Sheet title="Photo" onClose={() => setViewing(null)}>
          {urls[viewing.fileName] ? (
            <img src={urls[viewing.fileName]} alt={`Receipt photo for ${tx.description}`} className="mx-auto max-h-[70dvh] w-auto rounded-xl" />
          ) : (
            <p className="text-sm text-slate-500">That picture is not on this device.</p>
          )}
        </Sheet>
      )}
    </>
  );
}
