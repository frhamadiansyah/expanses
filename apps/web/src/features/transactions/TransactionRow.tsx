import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, replaceTransaction } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { SwipeRow } from '../../ui/SwipeRow';
import { UndoToast } from '../../ui/UndoToast';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CategoryPicker } from './CategoryPicker';
import { isEditable } from './draft';
import type { ListRow } from './list-model';
import { isQuickEditable, quickFromTransaction, quickToInput, type QuickValues, readQuick } from './quick-row';

/**
 * One transaction, in every list that shows transactions.
 *
 * The phone's three gestures live here: tap the row for its receipt, swipe it for Edit and Delete, tap the
 * category circle to re-file it. A desktop keeps its own way in — the row's click still opens the editor in
 * place — and gains the same reach by keyboard, because the row's face is a real button rather than a
 * `tabIndex` on an `<li>`.
 *
 * Three controls side by side, never nested: a `<button>` inside a `<button>` is invalid HTML, and the outer
 * one's accessible name swallows the inner one's, so `Category for Superindo` would never be reachable.
 */
export function TransactionRow({
  row,
  accounts,
  currency,
  amountMinor,
  testId = 'transaction-row',
  label,
  subtitle,
  under,
  iconLabel,
  amountExtra,
  trailing,
  onOpen,
  onEdit,
  onDelete,
  onRecategorise,
  phone,
  title,
  className,
}: {
  row: ListRow;
  accounts: readonly AccountRow[];
  /** What the amount is written in; the row's own currency unless a screen keeps one column in its own. */
  currency?: string;
  /** The figure to print, when a screen shows something other than what was charged — an event shows base. */
  amountMinor?: number;
  testId?: string;
  /** The first line. The category by default — the list writes its own, with a date and a workspace badge. */
  label?: ReactNode;
  /** The second line. "description · account ···· 1234" by default. */
  subtitle?: ReactNode;
  /** Anything below the two lines, inside the row's tap target: the event's item pills, say. */
  under?: ReactNode;
  /** Written in the category circle instead of its glyph — a day number, under a category heading. */
  iconLabel?: string;
  /** Under the amount: points earned, or what it cost in the currency it was charged in. */
  amountExtra?: ReactNode;
  /** The end of the row: the pencil and the ⓘ on a desktop, an untag button on an event. */
  trailing?: ReactNode;
  /** Tapping the row's face. The receipt on a phone, the editor in place on a desktop. */
  onOpen?: (row: ListRow) => void;
  /** What the swipe's Edit calls. No Edit is offered when this is absent. */
  onEdit?: (row: ListRow) => void;
  /** What the swipe's Delete calls, once it has been asked twice. No Delete is offered when this is absent. */
  onDelete?: (row: ListRow) => void;
  /** Tapping the category circle. Absent on a row that may not be re-filed, which leaves a plain circle. */
  onRecategorise?: (row: ListRow) => void;
  phone?: boolean;
  title?: string;
  className?: string;
}) {
  // Asked twice, as everywhere else in this app: the first press arms the button, the second deletes.
  const [armed, setArmed] = useState(false);
  const transfer = row.type !== 'expense' && row.type !== 'income';
  const money = formatMinor(amountMinor ?? row.amountMinor, currency ?? row.currency);
  const sign = row.type === 'expense' ? -1 : row.type === 'income' ? 1 : 0;

  const circle = (
    <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={transfer} label={iconLabel} />
  );

  /**
   * The row's content. `swiped` only on the phone's swipe layer, where the content must be opaque to cover the
   * Edit and Delete buttons behind it — on a desktop that same `bg-white` painted over the `<li>`'s
   * `hover:bg-slate-50` and left the tint showing in the gutters alone.
   */
  const face = (swiped?: { suppressClick: () => boolean }) => (
    <div className={cx('flex items-center gap-3 py-2', swiped && 'bg-white', className)}>
      {onRecategorise ? (
        <button
          type="button"
          aria-label={`Category for ${row.description}`}
          title="Change the category"
          onClick={(event) => {
            // The row around it may be clickable too; re-filing is not opening.
            event.stopPropagation();
            if (swiped?.suppressClick()) return;
            onRecategorise(row);
          }}
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          {circle}
        </button>
      ) : (
        <span className={cx('shrink-0', row.deleted && 'grayscale')}>{circle}</span>
      )}
      <div className="min-w-0 flex-1">
      <button
        type="button"
        disabled={!onOpen}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          if (swiped?.suppressClick()) return;
          onOpen?.(row);
        }}
        className="block w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-default"
      >
        <span className="block truncate text-sm font-medium">
          {label ?? (row.categoryName || (transfer ? 'Transfer' : 'Uncategorised'))}
          {/* §4.4: a purchase that is not this person's spending stays on the list, saying so. */}
          {row.excluded && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-500">Excluded</span>}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {subtitle ?? (
            <>
              {row.description ? `${row.description}${row.accountLabel ? ' · ' : ''}` : ''}
              {row.accountLabel}
              {row.last4 && <span className="tabular font-semibold text-slate-600"> ···· {row.last4}</span>}
            </>
          )}
        </span>
      </button>
      {/* Outside the tap target, never inside it: what goes here can itself be a control, and a <button>
          within a <button> is invalid HTML whose name swallows the inner one's. */}
      {under}
      </div>
      <span className="shrink-0 text-right">
        <span
          className={cx(
            'tabular block text-sm font-semibold whitespace-nowrap',
            sign < 0 && 'text-red-700',
            sign > 0 && 'text-emerald-700',
            row.excluded && 'line-through',
          )}
        >
          {money}
        </span>
        {amountExtra}
      </span>
      {trailing}
    </div>
  );

  // A phone reaches Edit and Delete by swiping; both stay one gesture away rather than crowding the row.
  if (phone && (onEdit || onDelete)) {
    return (
      <li className={cx('list-none', row.excluded && 'opacity-60', row.deleted && 'opacity-50 line-through')}>
        <SwipeRow
          enabled
          reveal={148}
          testId={testId}
          leftAction={
            <>
              {onEdit && (
                <button type="button" onClick={() => onEdit(row)} title={`Edit ${row.description}`} className="w-[74px] bg-slate-600 text-sm font-semibold text-white">
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (!armed) setArmed(true);
                    else onDelete(row);
                  }}
                  title={`Delete ${row.description}`}
                  className="w-[74px] bg-red-700 text-sm font-semibold text-white"
                >
                  {armed ? 'Delete?' : 'Delete'}
                </button>
              )}
            </>
          }
        >
          {(suppressClick) => face({ suppressClick })}
        </SwipeRow>
      </li>
    );
  }

  return (
    <li
      data-testid={testId}
      title={title}
      onClick={onOpen ? () => onOpen(row) : undefined}
      className={cx(
        'group',
        row.excluded && 'opacity-60',
        row.deleted && 'opacity-50 line-through',
        onOpen && '-mx-2 cursor-pointer rounded-lg px-2 hover:bg-slate-50',
      )}
    >
      {face()}
    </li>
  );
}

/**
 * The gesture behind the category circle, wherever a row offers it: pick a category, it is filed at once,
 * and a toast holds the way back for four seconds.
 *
 * One copy, used by every list that shows `TransactionRow` — the list, an event's history — because a second
 * copy is a second place for "Moved to X" and its Undo to drift apart.
 *
 * `Task 16` replaces the sheet's body with `CategoryPicker`; the title, the gesture and the toast stay.
 */
export function useRecategorise(): {
  /** Whether this row may be re-filed at all: a plain purchase, still editable, still ours to edit. */
  offers: (row: ListRow) => boolean;
  start: (row: ListRow) => void;
  /** The sheet and the toast. Render it once, at the end of the screen. */
  overlay: ReactNode;
} {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const [picking, setPicking] = useState<ListRow | null>(null);
  const [toast, setToast] = useState<{ text: string; back: () => Promise<void> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const today = isoDate();

  // Only a plain purchase: a split, a transfer, an opening balance or a price in another currency cannot be
  // re-filed by picking one category, which is exactly what the list and the table already refuse to edit in place.
  const offers = (row: ListRow) => row.kind === 'tx' && !row.deleted && !!row.tx && isEditable(row.tx) && isQuickEditable(row.tx);

  /**
   * The purchase again, filed under another category — and the id of what that left behind.
   *
   * An edit voids the original and posts a replacement, so the way back is not "re-file that row": that row is
   * void now. Undo re-files the *replacement*, with the same cells it went in with and the category it had.
   */
  async function fileAs(id: string, values: QuickValues, categoryId: string): Promise<string> {
    const { read } = readQuick({ ...values, categoryId }, accounts, today, ws.baseCurrency);
    if (!read) throw new Error('This purchase cannot be re-filed from the list. Open it to edit it.');
    const rates = await resolveRates(read.currency === ws.baseCurrency ? [] : [read.currency], read.occurredOn);
    if (rates.missing.length > 0) throw new Error(`No ${rates.missing[0]}→${ws.baseCurrency} rate for ${read.occurredOn}.`);
    const replacement = await replaceTransaction(database, ws, id, { ...quickToInput(read, accounts), ratesToBase: rates.rates });
    await invalidate();
    return replacement;
  }

  async function run(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e);
    }
  }


  return {
    offers,
    start: (row) => {
      setError(null);
      setPicking(row);
    },
    overlay: (
      <>
        {picking && (
          <CategoryPicker
            kind="expense"
            // Re-filing posts through `expenseLines`: income is not a place a purchase can be moved to.
            lockKind
            title={`Category for ${picking.description}`}
            value={picking.categoryId ?? undefined}
            onPick={(categoryId) => {
              const tx = picking.tx!;
              const was = picking.categoryId;
              const values = quickFromTransaction(tx, today);
              const name = accounts.find((account) => account.id === categoryId)?.name ?? 'that category';
              void run(async () => {
                const moved = await fileAs(tx.id, values, categoryId);
                setToast({
                  text: `Moved to ${name}`,
                  back: async () => {
                    if (was) await fileAs(moved, values, was);
                  },
                });
              });
            }}
            onClose={() => setPicking(null)}
          />
        )}
        {/* Outside the sheet, so it outlives it: the row has already moved by the time this is read. */}
        {toast && (
          <UndoToast
            text={toast.text}
            onUndo={() => {
              const back = toast.back;
              setToast(null);
              void run(back);
            }}
            onDone={() => setToast(null)}
          />
        )}
        {error !== null && !picking && <ErrorBox error={error} />}
      </>
    ),
  };
}
