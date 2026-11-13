import { formatMinor, isoDate } from '@expanses/core';
import { type AccountRow, replaceTransaction, type TransactionView } from '@expanses/db';
import { Copy, Pencil, Trash2, Undo2 } from 'lucide-react';
import { type MouseEvent, type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { SelectCircle } from '../../ui/native';
import { SwipeRow } from '../../ui/SwipeRow';
import { UndoToast } from '../../ui/UndoToast';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CategoryPicker } from './CategoryPicker';
import { isEditable } from './draft';
import { type AmountExtraPart, amountExtraParts, amountLook, type AmountView, type ListRow, paidWithLook, wholeLeftOut } from './list-model';
import { canRefile, emptyForm, refiledPost } from './tx-form';
import { ratesForSave } from './tx-save';
import { RowEventLead } from '../events/EventMode';
import { useEvents } from '../events/queries';

/** An event's name by its id, from the one owner-wide read of events; null for none, or one no longer here. */
export function useEventName(eventId: string | null): string | null {
  const events = useEvents().data;
  if (!eventId) return null;
  return events?.find((event) => event.id === eventId)?.name ?? null;
}

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
  iconMark,
  amountExtra,
  trailing,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onRecategorise,
  phone,
  busy,
  title,
  className,
  itemProps,
  select,
  still = false,
  amount,
  view = 'report',
  hideEvent = false,
}: {
  row: ListRow;
  /** The event's own page: every row there is in it, so the grey line does not say so again. */
  hideEvent?: boolean;
  accounts: readonly AccountRow[];
  /** What the amount is written in; the row's own currency unless a screen keeps one column in its own. */
  currency?: string;
  /** The figure to print, when a screen shows something other than what was charged — an event shows base. */
  amountMinor?: number;
  testId?: string;
  /** The first line. The category by default — the list writes its own, with a date and a workspace badge. */
  label?: ReactNode;
  /** The second line. "description · 1234" by default: the card by its last four digits. */
  subtitle?: ReactNode;
  /** Anything below the two lines, inside the row's tap target: the event's item pills, say. */
  under?: ReactNode;
  /** Written in the category circle instead of its glyph — a day number, under a category heading. */
  iconLabel?: string;
  /** Laid on the category circle's corner: whose workspace the row is, on a list that holds several. */
  iconMark?: ReactNode;
  /** Under the amount: points earned, or what it cost in the currency it was charged in. */
  amountExtra?: ReactNode;
  /** The end of the row: the pencil and the ⓘ on a desktop, an untag button on an event. */
  trailing?: ReactNode;
  /** Tapping the row's face. The receipt on a phone, the editor in place on a desktop. */
  onOpen?: (row: ListRow) => void;
  /** What the swipe's Edit calls. No Edit is offered when this is absent. */
  onEdit?: (row: ListRow) => void;
  /** What the swipe's Duplicate calls. No Duplicate is offered when this is absent. */
  onDuplicate?: (row: ListRow) => void;
  /** What the swipe's Delete calls — a tap or a long swipe, at once; the list offers Undo. No Delete is offered when this is absent. */
  onDelete?: (row: ListRow) => void;
  /** Tapping the category circle. Absent on a row that may not be re-filed, which leaves a plain circle. */
  onRecategorise?: (row: ListRow) => void;
  phone?: boolean;
  /** True while this row's own write is going out, so the swipe's Delete cannot be pressed a second time. */
  busy?: boolean;
  title?: string;
  className?: string;
  /** Attributes for the row's `<li>`: what a list that can be reordered finds its rows by (`reorderAttrs`). */
  itemProps?: Record<`data-${string}`, string>;
  /**
   * Select mode: whether this row is ticked, and what ticking it does. While it is given the row is a choice and
   * nothing else — no receipt, no swipe, no category circle — so a tap can only ever tick or untick. A row that
   * cannot be chosen passes no `onToggle`, and shows no tick at all.
   */
  select?: { selected: boolean; onToggle?: () => void };
  /**
   * The face drawn as a plain `<div>` rather than a `<button>`, so the caller's `label`, `subtitle` and `amount` may
   * hold buttons of their own — One line's preview row, whose every part opens its picker — without a button inside a
   * button.
   */
  still?: boolean;
  /** Drawn in place of the formatted figure, inside the same coloured span: a button standing for the amount, say. */
  amount?: ReactNode;
  /**
   * What the list's figures are. `report` (Cashflow, an event): a row excluded from the report reads Rp 0 with the
   * whole sum under it (⊘). `balance` (an account's Recent): every row reads what it moved, excluded or not.
   */
  view?: AmountView;
}) {
  const transfer = row.type !== 'expense' && row.type !== 'income';
  // A row in an event names it first on its grey line ("<plane> Lake trip · …"), on every list, in event mode or not.
  const eventName = useEventName(hideEvent ? null : (row.eventId ?? row.tx?.eventId ?? row.draft?.eventId ?? null));
  // Money back on a purchase reads as money in: a plus, in green. Money a person paid back has a plus too, muted.
  // Wholly excluded from the report, a row reads as a split with all of it left out: nothing counted on top, in grey,
  // and the whole sum under it with ⊘ (`amountExtraParts`), so the two kinds of left out look alike.
  const allOut = wholeLeftOut(row, view);
  const shownMinor = allOut ? 0 : (amountMinor ?? row.amountMinor);
  const { sign, plus, muted } = amountLook(row, view);
  const money = plus ? `+${formatMinor(Math.abs(shownMinor), currency ?? row.currency)}` : formatMinor(shownMinor, currency ?? row.currency);

  // Money back wears a small return arrow on its category's circle, where a shared row wears its workspace: the
  // category stays the category, and the green plus beside it says the rest. A workspace mark takes the corner first.
  const mark =
    iconMark ??
    (row.refund ? (
      <span
        className="absolute -right-1 -bottom-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)] ring-2 ring-[var(--ph-surface)]"
        title="Refund"
      >
        <Undo2 size={9} strokeWidth={3} aria-hidden />
        <span className="sr-only">Refund</span>
      </span>
    ) : undefined);
  const circle = mark ? (
    <span className="relative inline-flex">
      <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={transfer} label={iconLabel} />
      {mark}
    </span>
  ) : (
    <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={transfer} label={iconLabel} />
  );

  /**
   * The row's content. `swiped` only on the phone's swipe layer, where the content must be opaque to cover the
   * Edit and Delete buttons behind it — on a desktop that same `bg-white` painted over the `<li>`'s
   * `hover:bg-slate-50` and left the tint showing in the gutters alone.
   */
  /*
   * The tick, at the row's head: a round one on a phone, as iOS draws a selection, and a plain checkbox column on a
   * wide screen. A row that cannot be chosen keeps the column's room, so the rows that can still line up.
   */
  const tick = select && (
    select.onToggle ? (
      phone ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={select.selected}
          aria-label={`Select ${row.description}`}
          onClick={(event) => {
            event.stopPropagation();
            select.onToggle?.();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          <SelectCircle picked={select.selected} className="h-7 w-7" />
        </button>
      ) : (
        <input
          type="checkbox"
          aria-label={`Select ${row.description}`}
          checked={select.selected}
          onClick={(event) => event.stopPropagation()}
          onChange={() => select.onToggle?.()}
          className="h-4 w-4 shrink-0 accent-slate-900"
        />
      )
    ) : (
      <span aria-hidden className={cx('shrink-0', phone ? 'w-7' : 'w-4')} />
    )
  );
  // In select mode a tap on the row's face ticks it; it never opens anything.
  const faceTap = select ? select.onToggle && (() => select.onToggle?.()) : onOpen && (() => onOpen(row));
  const refile = select ? undefined : onRecategorise;

  const face = (swiped?: { suppressClick: () => boolean }) => (
    <div className={cx('flex items-center gap-3 py-2', swiped && 'bg-white', className)}>
      {tick}
      {refile ? (
        <button
          type="button"
          aria-label={`Category for ${row.description}`}
          title="Change the category"
          onClick={(event) => {
            // The row around it may be clickable too; re-filing is not opening.
            event.stopPropagation();
            if (swiped?.suppressClick()) return;
            refile(row);
          }}
          className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-slate-900"
        >
          {circle}
        </button>
      ) : (
        <span className={cx('shrink-0', row.deleted && 'grayscale')}>{circle}</span>
      )}
      <div className="min-w-0 flex-1">
      <Face
        still={still}
        disabled={!faceTap}
        title={select ? undefined : title}
        onClick={(event) => {
          event.stopPropagation();
          if (swiped?.suppressClick()) return;
          faceTap?.();
        }}
      >
        <span className="block truncate text-sm font-medium">
          {label ?? ((row.categoryName && row.moreCounted ? `${row.categoryName} +${row.moreCounted}` : row.categoryName) || (row.type === 'correction' ? 'Balance correction' : transfer ? 'Transfer' : 'Uncategorised'))}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {eventName && <RowEventLead name={eventName} />}
          {subtitle ?? (
            <>
              {row.description ? `${row.description}${row.accountLabel || row.last4 ? ' · ' : ''}` : ''}
              <PaidWith row={row} />
            </>
          )}
        </span>
      </Face>
      {/* Outside the tap target, never inside it: what goes here can itself be a control, and a <button>
          within a <button> is invalid HTML whose name swallows the inner one's. */}
      {under}
      </div>
      {/* At most 40% of the row, so the longest line under an amount — a foreign figure and points in a long unit —
          never squeezes the category and the note to a sliver at a phone's width; the points give way first. */}
      <span className="min-w-0 max-w-[40%] shrink-0 text-right">
        <span
          className={cx(
            'tabular block text-sm font-semibold whitespace-nowrap',
            sign < 0 && 'text-red-700',
            sign > 0 && 'text-emerald-700',
            muted && 'text-slate-500',
          )}
        >
          {amount ?? money}
        </span>
        {amountExtra ?? (row.leftOut || allOut ? <AmountExtra parts={amountExtraParts(row.tx ?? { originalCurrency: null, originalAmountMinor: null }, undefined, { ...row, view })} /> : null)}
      </span>
      {trailing}
    </div>
  );

  // A phone reaches Edit and Delete by swiping; both stay one gesture away rather than crowding the row. Not while
  // selecting: a drag across a list being ticked is a scroll, never an Edit.
  if (phone && !select && (onEdit || onDelete || onDuplicate)) {
    return (
      <li {...itemProps} className={cx('list-none', row.deleted && 'opacity-50 line-through')}>
        <SwipeRow
          enabled
          testId={testId}
          actions={[
            ...(onDuplicate ? [{ label: 'Duplicate', icon: Copy, tone: 'neutral' as const, title: `Duplicate ${row.description}`, onPress: () => onDuplicate(row) }] : []),
            ...(onEdit ? [{ label: 'Edit', icon: Pencil, tone: 'primary' as const, title: `Edit ${row.description}`, onPress: () => onEdit(row) }] : []),
            // Destructive: one tap, or a long swipe, deletes at once — the list's Undo toast is the way back.
            ...(onDelete ? [{ label: 'Delete', icon: Trash2, tone: 'destructive' as const, title: `Delete ${row.description}`, disabled: busy, onPress: () => onDelete(row) }] : []),
          ]}
        >
          {(suppressClick) => face({ suppressClick })}
        </SwipeRow>
      </li>
    );
  }

  return (
    <li
      {...itemProps}
      data-testid={testId}
      title={select ? undefined : title}
      onClick={faceTap}
      className={cx(
        'group',
        row.deleted && 'opacity-50 line-through',
        faceTap && '-mx-2 cursor-pointer rounded-lg px-2 hover:bg-slate-50',
      )}
    >
      {face()}
    </li>
  );
}

/**
 * The two lines' holder: the tap target a row's face is, or — `still` — a plain block whose contents bring their own
 * controls. Either way it is laid out the same, so a still row reads exactly as the list's own.
 */
function Face({
  still,
  disabled,
  title,
  onClick,
  children,
}: {
  still: boolean;
  disabled: boolean;
  title?: string;
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  if (still) return <div className="block w-full min-w-0 text-left">{children}</div>;
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="block w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-default"
    >
      {children}
    </button>
  );
}

/**
 * What paid, as a row's second line names it: "4417" alone for a card whose digits are known, the account's name
 * otherwise, and both names of a transfer with each side's digits after it (`paidWithLook`). The digits read in the
 * line's own weight — tabular, so they line up, but no bolder than the note beside them.
 */
export function PaidWith({ row }: { row: ListRow }) {
  const { name, last4 } = paidWithLook(row);
  return (
    <>
      {name}
      {last4 && <span className="tabular">{name ? ' ' : ''}{last4}</span>}
    </>
  );
}

/**
 * A row not recorded yet, on its second line: the note, then what paid as a recorded row names it (`PaidWith`). The row
 * already shows what else it is missing; only the account it was paid with has nowhere else to show.
 */
export function DraftSubtitle({ row }: { row: ListRow }) {
  return (
    <>
      {row.description || 'No description yet'}
      {(row.accountLabel || row.last4) && ' · '}
      <PaidWith row={row} />
      {row.needs.includes('paid with') && ' · needs an account'}
    </>
  );
}

/**
 * The one line under a row's amount (`amountExtraParts`): a transfer's fee and the foreign amount, muted, then the
 * points in their colour. Always one line: when the row's right side is out of room the points are cut short with an
 * ellipsis — the fee and the foreign figure, being money, never are — and the whole line is the element's title.
 */
export function AmountExtra({ parts }: { parts: readonly AmountExtraPart[] }) {
  if (parts.length === 0) return null;
  return (
    <span data-testid="amount-extra" title={parts.map((part) => part.text).join(' · ')} className="tabular flex justify-end whitespace-nowrap text-xs">
      {parts.map((part, i) => (
        <span
          // By place, not tone: a fee and a foreign amount are both muted.
          key={`${part.tone}-${i}`}
          className={cx(
            part.tone === 'foreign' ? 'shrink-0 text-slate-500' : 'min-w-0 truncate',
            part.tone === 'lost' && 'text-red-700',
            part.tone === 'earned' && 'text-emerald-700',
          )}
        >
          {/* No-break spaces: at the start of a flex item a plain one is dropped, and the dot would touch the figure. */}
          {i > 0 && <span className="text-slate-400">{' · '}</span>}
          {part.label ? <span aria-label={part.label}>{part.text}</span> : part.text}
        </span>
      ))}
    </span>
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
  // One category and one account: a purchase, a refund or an income, foreign or not. A split, a transfer or an
  // opening balance cannot be re-filed by picking one category.
  const offers = (row: ListRow) => row.kind === 'tx' && !row.deleted && !!row.tx && isEditable(row.tx) && canRefile(row.tx);

  /**
   * The transaction again, filed under another category — and the id of what that left behind. Only the category is
   * swapped, through the edit path (`refiledPost`), so a refund stays money back and a foreign purchase keeps what the
   * merchant charged, its card and its MCC.
   *
   * An edit voids the original and posts a replacement, so the way back is not "re-file that row": that row is
   * void now. Undo re-files the *replacement*, read as the original was, with the category it had.
   */
  async function fileAs(tx: TransactionView, categoryId: string): Promise<string> {
    const post = refiledPost(tx, accounts, categoryId, ws.bookId ?? '');
    if (post.kind !== 'post') throw new Error('This transaction cannot be re-filed from the list. Open it to edit it.');
    const draft = { ...emptyForm(ws.bookId ?? '', tx.occurredOn), occurredOn: tx.occurredOn };
    const ratesToBase = await ratesForSave({
      database, ws, draft, post, accounts, rateDate: tx.occurredOn > isoDate() ? isoDate() : tx.occurredOn, needsRate: null, resolveRates,
      onMissing: () => undefined, where: 'Edit',
    });
    const replacement = await replaceTransaction(database, ws, tx.id, { ...post.input, ratesToBase });
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
            kind={picking.type === 'income' ? 'income' : 'expense'}
            // Only the category is swapped: a purchase stays spending and an income stays income.
            lockKind
            title={`Category for ${picking.description}`}
            value={picking.categoryId ?? undefined}
            onPick={(categoryId) => {
              const tx = picking.tx!;
              const was = picking.categoryId;
              const name = accounts.find((account) => account.id === categoryId)?.name ?? 'that category';
              void run(async () => {
                const moved = await fileAs(tx, categoryId);
                setToast({
                  text: `Moved to ${name}`,
                  // The replacement is the original with its category swapped, so it is read as the original was.
                  back: async () => {
                    if (was) await fileAs({ ...tx, id: moved }, was);
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
            icon="category"
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
