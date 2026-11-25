import type { TransactionPhotoRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Calendar,
  CalendarDays,
  ChartPie,
  ChevronRight,
  CircleCheck,
  Clock,
  Coins,
  CreditCard,
  Dot,
  Flag,
  Globe,
  History,
  House,
  Image as ImageIcon,
  type LucideIcon,
  ReceiptText,
  Star,
  Undo2,
  User,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox } from '../../ui';
import { PILL, PILL_BLUE } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { PANEL_GROUP } from '../../ui/native/panel-frame';
import { PEEK_BUTTON, PEEK_FOOT, SidePeek } from '../../ui/native/SidePeek';
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
import { kindWord, type PeekLine, type PeekLinesInput, peekFigure, receiptPeekLines, receiptPeekPanel } from './receipt-peek-model';
import { instalmentRowValue } from './turn-into';
import { TurnIntoSheet } from './TurnIntoSheet';
import { type Receipt, useReceipt } from './use-receipt';
import { paidAccountId } from './receipt-view';
import { NOT_MONTHLY_BILL_NOTE } from './not-monthly';
import { TableMenu, type TableMenuItem } from './TableMenu';

/** "Wed 11 Nov 2026". */
const peekDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** "Sun, 1 Nov 2026": the day as the edit form's date row says it. */
const panelDate = (iso: string) => {
  const at = new Date(`${iso}T00:00:00`);
  return `${at.toLocaleDateString('en-GB', { weekday: 'short' })}, ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

/** Delete asks twice, in place, as the receipt's does: the state dies with the button. */
function DeletePeek({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  return (
    <button
      type="button"
      disabled={busy}
      onBlur={onBlur}
      onClick={onClick}
      data-peek-delete
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
  notMonthlyOut = false,
  keys = false,
}: {
  transactionId: string;
  /** The table's keys work on it (Mac Cashflow, owner 2026-11-25): ⌘D duplicates, ⌫ ⌫ deletes. */
  keys?: boolean;
  /** Cashflow's month leaves this not-monthly bill's payment out of its figures (`leaveOutNotMonthly`): the peek says so, with the bill. */
  notMonthlyOut?: boolean;
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
  // The v1 panel says the day under the title, and whether it is recorded or deleted (owner, 2026-11-24).
  const subtitle = !macV2 && tx ? `${panelDate(tx.occurredOn)} · ${tx.status === 'void' ? 'Deleted' : 'Recorded'}` : undefined;
  return (
    <SidePeek top={top} label="Transaction details" testId={testId} title={title} titleTestId="peek-title" subtitle={subtitle} noun="transaction" first={first} last={last} onStep={onStep} onClose={onClose} back={back}>
      {receipt.receipt.isSuccess && !tx ? (
        <p className="px-[14px] py-2 text-[13px] text-[var(--ph-ink-3)]">That transaction is not on this device.</p>
      ) : tx && view ? (
        macV2 ? (
          <PeekBody key={transactionId} receipt={receipt} notMonthlyOut={notMonthlyOut} keys={keys} />
        ) : (
          <PanelBody key={transactionId} receipt={receipt} notMonthlyOut={notMonthlyOut} keys={keys} />
        )
      ) : (
        <ErrorBox error={receipt.receipt.error} />
      )}
    </SidePeek>
  );
}

/** The peek's rows, as the receipt says them: what `receiptPeekLines` and `receiptPeekPanel` lay out. */
function peekInput(receipt: Receipt, needs: Parameters<typeof countsAs>[1], workspaceName: string | null): PeekLinesInput {
  const { tx, view, paidOffMark, bill } = receipt;
  const { kind, categoryNames, book, plan, instalmentCard } = view!;
  const word = kindWord(kind.type);
  const counts = kind.type === 'expense' && kind.categoryIds[0] ? countsAs({ type: 'expense', categoryId: kind.categoryIds[0] }, needs) : '';
  return {
    // A transfer, an opening balance, a correction read as what they are; a transfer's fee is not its category.
    category: word ?? (categoryNames.join(', ') || 'Uncategorised'),
    lines: view!.lines,
    countsAs: counts && counts !== '—' ? counts : null,
    workspace: book?.name ?? workspaceName,
    bill: view!.billRow ? (bill ? 'Linked' : 'None') : null,
    paidOff: paidOffMark ? { label: paidOffMark.refund ? 'Settled' : 'Paid off', on: paidOffMark.settled } : null,
    instalments: plan || instalmentCard ? instalmentRowValue(plan, kind.currency) : null,
    past: !!tx!.past && tx!.status === 'posted',
  };
}

/** A click on a row the receipt acts on: the bill, Paid off, the instalments' plan, or Turn into instalments. */
function peekAct(receipt: Receipt, navigate: ReturnType<typeof useNavigate>, turnInto: () => void) {
  const { view, paidOffMark } = receipt;
  return (action: NonNullable<PeekLine['action']>) => {
    const plan = view?.plan;
    if (action === 'bill') view?.openBill();
    else if (action === 'paid-off') void receipt.markPaidOff(!(paidOffMark?.settled ?? false));
    else if (plan) void navigate({ to: '/cards/$cardId/settings/instalments/$planId', params: { cardId: plan.cardAccountId, planId: plan.id } });
    else turnInto();
  };
}

/** What the peek offers, by the receipt's own refusals: Edit, Split, Remove from event, and why not, when not here. */
function peekDoings(receipt: Receipt, readOnly: boolean, navigate: ReturnType<typeof useNavigate>) {
  const { tx, view, fromEvent, onEvent, elsewhere, isTrade, holdingId } = receipt;
  const transactionId = tx!.id;
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
  const splittable = !!view && view.editable && !fromEvent && view.kind.type === 'expense' && !tx!.originalCurrency && !view.cardPayment;
  // Remove from event: a transfer listed on a shared event, or a purchase in an event this receipt may change.
  const removable = (onEvent && tx!.status === 'posted') || (!!view?.deletable && !!tx!.eventId && !onEvent);
  // Why nothing here changes it, and where it can be.
  const notice = elsewhere ? (
    <SwitchToEdit book={elsewhere} />
  ) : isTrade && holdingId ? (
    'A trade is changed on its holding’s page.'
  ) : readOnly ? (
    'This share has ended: nothing here is changed.'
  ) : null;
  const anyButton = !!view && (view.editable || view.duplicable || splittable || removable || view.deletable);
  return { edit, split, splittable, removable, notice, anyButton };
}

function PeekBody({ receipt, notMonthlyOut, keys }: { receipt: Receipt; notMonthlyOut: boolean; keys: boolean }) {
  const navigate = useNavigate();
  usePeekKeys(receipt, keys);
  const needs = useResolvedNeeds().data;
  const openBook = useOpenBook();
  const readOnly = useOpenBookReadOnly();
  const [turning, setTurning] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);
  const { tx, view, accounts, busy, error, photos, urls, jointNote, fromEvent, onEvent, bill, elsewhere, isTrade, holdingId } = receipt;
  if (!tx || !view) return null;
  const { kind, instalmentCard } = view;
  const transactionId = tx.id;
  const figure = peekFigure(kind);
  const word = kindWord(kind.type);

  const lines = receiptPeekLines(peekInput(receipt, needs, openBook?.name ?? null));
  const act = peekAct(receipt, navigate, () => setTurning(true));

  const { edit, split, splittable, removable, notice, anyButton } = peekDoings(receipt, readOnly, navigate);

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
        {notMonthlyOut && (
          <div data-testid="not-monthly-peek-note" className="mt-[2px] text-[12px] text-[var(--ph-ink-3)]">
            {bill ? `${bill.name} · ` : ''}
            {NOT_MONTHLY_BILL_NOTE}
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

/** Each row's small grey mark in the v1 panel, by its label. */
const ROW_ICONS: Readonly<Record<string, LucideIcon>> = {
  'Paid with': CreditCard,
  From: ArrowUpRight,
  Into: ArrowDownLeft,
  'Paid into': ArrowDownLeft,
  'Paid by': User,
  Total: Banknote,
  Cashback: Undo2,
  Refund: Undo2,
  Rate: ArrowLeftRight,
  Cost: Banknote,
  Withdrawn: Banknote,
  Points: Star,
  'My share': ChartPie,
  Event: CalendarDays,
  'For goal': Flag,
  Channel: Globe,
  'Original amount': Coins,
  'Bill month': Calendar,
  Workspace: House,
  Bill: ReceiptText,
  Instalments: Clock,
  'Paid off': CircleCheck,
  Settled: CircleCheck,
  'Past purchase': History,
  Receipt: ImageIcon,
};

const rowIcon = (label: string): LucideIcon => ROW_ICONS[label] ?? (label.startsWith('Charged on') ? CreditCard : label.startsWith('Owed by') ? Users : Dot);

/** A row of a v1 panel's grey box: its mark and label on the left, the value on the right. */
const PANEL_ROW = 'flex min-h-[42px] items-center gap-[11px] border-t border-[var(--mk-line)] py-[8px] text-[14px] leading-[19px] first:border-t-0';

function RowHead({ label }: { label: string }) {
  const Icon = rowIcon(label);
  return (
    <>
      <span className="flex w-[18px] shrink-0 justify-center text-[var(--mk-ink-2)]">
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <dt className="w-[104px] shrink-0 break-words text-[var(--mk-ink-2)]">{label}</dt>
    </>
  );
}

/** The value of a row that goes somewhere: right-aligned, a grey › after it. */
function Onward({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="min-w-0 break-words">{children}</span>
      <ChevronRight size={15} aria-hidden className="shrink-0 text-[var(--mk-ink-3)]" />
    </>
  );
}

const ONWARD = 'flex w-full items-center justify-end gap-[6px] rounded-[6px] text-right focus-visible:outline-2 focus-visible:outline-[var(--mk-blue)]';

/** The capsule switch the forms draw (`SwitchRow`), small: the checkbox is still the control, laid over it unseen. */
function PanelSwitch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: () => void }) {
  return (
    <span
      className={cx(
        'relative inline-flex h-[23px] w-[38px] shrink-0 rounded-full transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--mk-blue)]',
        on ? 'bg-[var(--ph-switch-on)]' : 'bg-[var(--mk-switch-off)]',
        disabled && 'opacity-40',
      )}
    >
      <span
        aria-hidden
        className="absolute top-[2px] left-[2px] h-[19px] w-[19px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform"
        style={on ? { transform: 'translateX(15px)' } : undefined}
      />
      <input type="checkbox" role="switch" aria-label={label} checked={on} disabled={disabled} onChange={onChange} className="absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default" />
    </span>
  );
}

/** Where the Paid with row goes: the card's page, or the account's. */
type PaidWithPage = { card: true; id: string } | { card: false; id: string };

/** One row of the v1 panel (owner, 2026-11-24): a plain line, a row that opens something (›), or Paid off's switch. */
export function PanelRow({ line, onAction, busy, page }: { line: PeekLine; onAction?: (action: NonNullable<PeekLine['action']>) => void; busy?: boolean; page?: PaidWithPage | null }) {
  const tone = line.tone === 'muted' ? 'text-[var(--mk-ink-3)]' : line.tone === 'points' ? 'font-semibold text-[var(--mk-c-green)]' : 'text-[var(--mk-ink)]';
  const value = (
    <>
      <span className={cx('block', tone)}>{line.value}</span>
      {line.detail && <span className="block text-[12px] text-[var(--mk-ink-2)]">{line.detail}</span>}
    </>
  );
  if (line.action === 'paid-off') {
    return (
      <div className={PANEL_ROW} data-testid={line.testId}>
        <RowHead label={line.label} />
        <dd className="flex min-w-0 flex-1 justify-end">
          <PanelSwitch label={line.label} on={line.on ?? false} disabled={busy} onChange={() => onAction?.('paid-off')} />
        </dd>
      </div>
    );
  }
  if (line.action && onAction) {
    return (
      <div className={PANEL_ROW}>
        <RowHead label={line.label} />
        <dd className="min-w-0 flex-1">
          <button type="button" data-testid={line.testId} onClick={() => onAction(line.action!)} aria-label={`${line.label}, ${line.value}`} className={ONWARD}>
            <Onward>{value}</Onward>
          </button>
        </dd>
      </div>
    );
  }
  if (page) {
    return (
      <div className={PANEL_ROW} data-testid={line.testId}>
        <RowHead label={line.label} />
        <dd className="min-w-0 flex-1 tabular-nums">
          {page.card ? (
            <Link to="/cards/$cardId" params={{ cardId: page.id }} aria-label={`${line.label}, ${line.value}`} className={ONWARD}>
              <Onward>{value}</Onward>
            </Link>
          ) : (
            <Link to="/accounts/$accountId" params={{ accountId: page.id }} aria-label={`${line.label}, ${line.value}`} className={ONWARD}>
              <Onward>{value}</Onward>
            </Link>
          )}
        </dd>
      </div>
    );
  }
  return (
    <div className={PANEL_ROW} data-testid={line.testId}>
      <RowHead label={line.label} />
      <dd className="min-w-0 flex-1 text-right break-words tabular-nums">{value}</dd>
    </div>
  );
}

/** Delete in the panel's foot: red words, asking twice in place (red filled while it asks), as the receipt's does. */
function DeletePanel({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  return (
    <button
      type="button"
      disabled={busy}
      onBlur={onBlur}
      onClick={onClick}
      data-peek-delete
      aria-label={armed ? 'Click again to delete' : 'Delete this transaction'}
      className={cx(
        'inline-flex h-[34px] shrink-0 items-center rounded-full text-[14px] font-semibold whitespace-nowrap disabled:opacity-40',
        armed ? 'bg-[var(--mk-c-red)] px-[14px] text-white' : '-ml-[8px] px-[8px] text-[var(--mk-c-red)] hover:bg-[var(--mk-pill)]',
      )}
    >
      {armed ? 'Click again to delete' : 'Delete'}
    </button>
  );
}

/**
 * The transaction peek in the v1 look (owner, 2026-11-24: docs/mockups/2026-11-24-mac-transaction-peek.html): the
 * forms' panel, read. The category's mark and the figure large, the category and Counts as under it; a grey box of what
 * paid (the receipt's lines, Total only where it is not the figure again) and the workspace; a grey box of what it is
 * tied to — Bill ›, Instalments ›, Paid off as a switch, the receipt's pictures; along the foot Delete in red on the
 * left, Duplicate and Split, and Edit in blue, which opens the edit form in this same panel. Every line and every button
 * is the receipt's (`PeekBody`'s), by the same rules; only the layout is the panel's.
 */
function PanelBody({ receipt, notMonthlyOut, keys }: { receipt: Receipt; notMonthlyOut: boolean; keys: boolean }) {
  const navigate = useNavigate();
  usePeekKeys(receipt, keys);
  const needs = useResolvedNeeds().data;
  const openBook = useOpenBook();
  const readOnly = useOpenBookReadOnly();
  const [turning, setTurning] = useState(false);
  const [viewing, setViewing] = useState<TransactionPhotoRow | null>(null);
  const { tx, view, accounts, busy, error, photos, urls, jointNote, fromEvent, onEvent, bill, elsewhere, isTrade, holdingId } = receipt;
  if (!tx || !view) return null;
  const { kind, instalmentCard } = view;
  const transactionId = tx.id;
  const figure = peekFigure(kind);
  const word = kindWord(kind.type);
  const panel = receiptPeekPanel({ ...peekInput(receipt, needs, openBook?.name ?? null), figure: figure.text });
  const act = peekAct(receipt, navigate, () => setTurning(true));
  const { edit, split, splittable, removable, notice, anyButton } = peekDoings(receipt, readOnly, navigate);
  // Paid with › opens the account it names — its card's page for a card — when it is one of this workspace's own.
  const paidId = paidAccountId(tx);
  const paidAccount = paidId && !elsewhere ? accounts.find((account) => account.id === paidId) : undefined;
  const paidPage = (line: PeekLine): PaidWithPage | null =>
    line.label === 'Paid with' && paidAccount && line.value.startsWith(paidAccount.name) ? { card: paidAccount.subtype === 'credit_card', id: paidAccount.id } : null;

  const notes = [
    // Which of the two figures this is, when the bill and the share of it are not the same number.
    view.caption && <span key="caption">{view.caption}</span>,
    // Spread by its plan: the purchase counts a month at a time (card instalments C).
    view.spread && (
      <span key="spread" data-testid="spread-caption">
        {view.spread}
      </span>
    ),
    // Left out of the month's figures, as its row says: which bill, and that the year counts it.
    notMonthlyOut && (
      <span key="not-monthly" data-testid="not-monthly-peek-note">
        {bill ? `${bill.name} · ` : ''}
        {NOT_MONTHLY_BILL_NOTE}
      </span>
    ),
    jointNote && (
      <span key="joint" data-testid="joint-note">
        {rowByLine({ recordedBy: jointNote.recordedBy, editedBy: jointNote.editedBy, deleted: false, deletedBy: null }, jointNote.me, jointNote.names)}
      </span>
    ),
    fromEvent && (
      <span key="from-event" data-testid="from-event">
        {fromEvent.deletedHere ? (
          deletedCopyLine(fromEvent.eventName)
        ) : (
          <>
            {fromEvent.changedByName ? `Changed by ${fromEvent.changedByName} · ` : ''}
            <Link to="/events/$eventId" params={{ eventId: fromEvent.eventId }} className="font-semibold text-[var(--mk-blue)] hover:underline">
              Open the event
            </Link>
          </>
        )}
      </span>
    ),
    onEvent && (
      <span key="on-event" data-testid="on-event">
        {`On ${onEvent.eventName ?? 'a shared event'}, not counted`}
        {onEvent.eventId ? (
          <>
            {' · '}
            <Link to="/events/$eventId" params={{ eventId: onEvent.eventId }} className="font-semibold text-[var(--mk-blue)] hover:underline">
              Open the event
            </Link>
          </>
        ) : null}
      </span>
    ),
    tx.excluded && (
      <span key="excluded" data-testid="excluded-note">
        Excluded from the chart and budgets. Still counted in balances, statements and points.
      </span>
    ),
  ].filter(Boolean);

  return (
    <>
      <div className="px-[14px]">
        <div className="mb-[16px] flex items-center gap-[12px]">
          <CategoryIcon categoryId={word ? null : (kind.categoryIds[0] ?? null)} accounts={accounts} transfer={word !== null} size="tile" />
          <div className="min-w-0">
            <div
              data-testid="peek-amount"
              className={cx(
                'text-[30px] leading-[36px] font-extrabold tracking-[-0.4px] break-words tabular-nums',
                tx.status === 'void' ? 'text-[var(--mk-ink-3)] line-through' : figure.income ? 'text-[var(--ph-up)]' : 'text-[var(--mk-ink)]',
              )}
            >
              {figure.text}
            </div>
            <div data-testid="peek-kind" className="text-[13px] leading-[18px] break-words text-[var(--mk-ink-2)]">
              {panel.kindLine}
            </div>
          </div>
        </div>
        {notes.length > 0 && <div className="-mt-[6px] mb-[14px] flex flex-col gap-[3px] text-[12.5px] leading-[17px] text-[var(--mk-ink-2)]">{notes}</div>}

        {panel.money.length > 0 && (
          <dl data-testid="peek-money" className={cx(PANEL_GROUP, 'mb-[12px]')}>
            {panel.money.map((line) => (
              <PanelRow key={line.key} line={line} page={paidPage(line)} />
            ))}
          </dl>
        )}

        <dl data-testid="peek-links" className={cx(PANEL_GROUP, 'mb-[12px]')}>
          {panel.links.map((line) => (
            <PanelRow key={line.key} line={line} onAction={act} busy={busy} />
          ))}
          {/* The pictures kept with it: a click shows one whole. None, and a row that can be changed is offered one. */}
          <div className={PANEL_ROW}>
            <RowHead label="Receipt" />
            <dd className="min-w-0 flex-1 text-right text-[var(--mk-ink-3)]">
              {photos.length > 0 ? (
                <div data-testid="photo-strip" className="flex flex-wrap justify-end gap-[6px]">
                  {photos.map((row) =>
                    urls[row.fileName] ? (
                      <button key={row.id} type="button" onClick={() => setViewing(row)} className="rounded-[8px] focus-visible:outline-2 focus-visible:outline-[var(--mk-blue)]">
                        <img src={urls[row.fileName]} alt={`Receipt photo for ${tx.description}`} className="h-[44px] w-[44px] rounded-[8px] object-cover ring-1 ring-[var(--mk-line)]" />
                      </button>
                    ) : (
                      <div key={row.id} className="h-[44px] w-[44px] rounded-[8px] bg-[var(--mk-pill)]" aria-hidden />
                    ),
                  )}
                </div>
              ) : view.editable && !fromEvent ? (
                <>
                  No photo ·{' '}
                  <Link to="/transactions/$transactionId/edit" params={{ transactionId }} className="font-semibold text-[var(--mk-blue)] hover:underline">
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
          <section data-testid="split-parts" aria-labelledby="peek-split-title" className={cx(PANEL_GROUP, 'mb-[12px] py-[8px]')}>
            <h3 id="peek-split-title" className="pb-[2px] text-[12px] font-semibold text-[var(--mk-ink-2)]">
              {tx.splitBooks ? 'Split across workspaces' : 'Split'}
            </h3>
            {view.parts.map((part, i) => (
              <SplitPartLine
                key={`${part.book?.id ?? 'not-counted'}:${part.categoryId}:${i}`}
                part={part}
                accounts={accounts}
                className="flex items-center gap-[8px] py-[5px] text-[13.5px] text-[var(--mk-ink)] [&_.text-slate-500]:text-[var(--mk-ink-2)] [&_.text-xs]:text-[12px]"
              />
            ))}
          </section>
        )}

        {notice && (
          <div data-testid="peek-notice" className="mb-[12px] text-[12.5px] text-[var(--mk-ink-2)] [&_.text-xs]:text-[12.5px]">
            {notice}
          </div>
        )}
        {error ? (
          <div className="mb-[12px]">
            <ErrorBox error={error} />
          </div>
        ) : null}
      </div>

      {(anyButton || (isTrade && holdingId)) && (
        <div className={PEEK_FOOT} data-testid="peek-foot">
          {view.deletable && <DeletePanel busy={busy} onConfirm={() => void receipt.remove()} />}
          <span className="flex-1" />
          {/* A trade is edited on its holding's page, so units stay in step: the receipt's one way there. */}
          {isTrade && holdingId && !elsewhere && (
            <button type="button" data-testid="open-holding" className={PILL} onClick={() => void navigate({ to: '/net-worth/assets/$accountId', params: { accountId: holdingId } })}>
              Open holding
            </button>
          )}
          {removable && (
            <button type="button" data-testid="remove-from-event" className={PILL} disabled={busy} onClick={() => void receipt.removeFromEvent()}>
              Remove from event
            </button>
          )}
          {view.duplicable && (
            <button type="button" className={PILL} disabled={busy} onClick={() => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId } })}>
              Duplicate
            </button>
          )}
          {splittable && (
            <button type="button" className={PILL} disabled={busy} onClick={split}>
              Split
            </button>
          )}
          {view.editable && (
            <button type="button" className={PILL_BLUE} disabled={busy} onClick={edit}>
              {view.cardPayment ? 'Edit payment' : 'Edit'}
            </button>
          )}
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

/**
 * The right-click menu of a recorded row on the Mac tables (owner 2026-11-25): the cells' Copy and Paste, Open (the
 * peek, Space), and what the peek itself offers for this row by the receipt's own refusals — Duplicate, Split…, Turn
 * into instalments…, Delete (asking twice). Nothing the peek would not offer.
 */
export function ReceiptRowMenu({ transactionId, x, y, lead, onOpen, onClose }: { transactionId: string; x: number; y: number; lead: readonly TableMenuItem[]; onOpen: () => void; onClose: () => void }) {
  const navigate = useNavigate();
  const readOnly = useOpenBookReadOnly();
  const receipt = useReceipt(transactionId, { onDeleted: () => undefined, onReplaced: () => undefined });
  const [turning, setTurning] = useState(false);
  const { tx, view, accounts, isTrade } = receipt;
  if (turning && tx && view?.instalmentCard) {
    const card = view.instalmentCard;
    return (
      <TurnIntoSheet
        purchase={{ transactionId: tx.id, description: tx.description, occurredOn: tx.occurredOn, amountMinor: card.amountMinor }}
        card={{ accountId: card.cardAccountId, name: accounts.find((a) => a.id === card.cardAccountId)?.name ?? '' }}
        currency={accounts.find((a) => a.id === card.cardAccountId)?.currency ?? view.kind.currency}
        investment={isTrade}
        onClose={onClose}
      />
    );
  }
  const items: TableMenuItem[] = [...lead, { key: 'open', label: 'Open', keys: 'Space', divided: true, onPick: onOpen }];
  if (tx && view) {
    const { split, splittable } = peekDoings(receipt, readOnly, navigate);
    if (view.duplicable) items.push({ key: 'duplicate', label: 'Duplicate', keys: '⌘D', onPick: () => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId } }) });
    if (splittable) items.push({ key: 'split', label: 'Split…', onPick: split });
    // Turn into instalments: a card purchase with no plan yet, as the peek's Instalments line offers it.
    if (view.instalmentCard && !view.plan && !readOnly) items.push({ key: 'turn', label: 'Turn into instalments…', onPick: () => setTurning(true) });
    if (view.deletable) items.push({ key: 'delete', label: 'Delete', keys: '⌫', danger: true, divided: true, onPick: () => void receipt.remove() });
  }
  // Turning keeps this mounted for its sheet: the menu's own close waits for it.
  return <TableMenu x={x} y={y} items={items} onClose={() => (turning ? undefined : onClose())} />;
}

/**
 * The peek's keys on the Mac tables (owner 2026-11-25), as the right-click menu says them: ⌘D duplicates the row, ⌫
 * asks to delete it and ⌫ again deletes it (the Delete button's own two presses) — never while typing, or under a sheet.
 */
function usePeekKeys(receipt: Receipt, enabled: boolean) {
  const navigate = useNavigate();
  const latest = useRef(receipt);
  latest.current = receipt;
  useEffect(() => {
    if (!enabled) return;
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || event.altKey || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const { view, tx } = latest.current;
      if (!view || !tx) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && !event.shiftKey && event.key.toLowerCase() === 'd' && view.duplicable) {
        event.preventDefault();
        void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId: tx.id } });
      } else if (!command && !event.shiftKey && (event.key === 'Backspace' || event.key === 'Delete') && view.deletable) {
        const button = document.querySelector<HTMLButtonElement>('[data-peek-delete]');
        if (!button) return;
        event.preventDefault();
        button.focus();
        button.click();
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [enabled, navigate]);
}
