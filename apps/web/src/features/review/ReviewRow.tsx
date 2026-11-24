import { formatMinor, groupedMajorString, isoDate } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow } from '@expanses/db';
import { Check } from 'lucide-react';
import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cx } from '../../ui';
import { macV2 } from '../../ui/mac-detail';
import { CategoryIcon } from '../categories/CategoryIcon';
import { cellCorner, cellLook, cellMarks, type CellPick } from '../transactions/cell-look';
import type { CellColumn } from '../transactions/cell-range';
import type { ComboAdd } from '../transactions/CellCombo';
import { type QuickValues, shortDate } from '../transactions/quick-row';
import { DESK_GRID, QuickRowEditor, type RowOptions } from '../transactions/QuickRowEditor';
import type { PeekPick } from './DraftPeek';
import { paidWithOf } from './review-desk-model';

/*
 * Mac Review's rows are Cashflow's waiting rows (owner, 2026-11-24: docs/mockups/2026-11-24-mac-review-like-cashflow.html):
 * the same 40px row, the blue circle, Date · Note · Category · Paid with · Amount typed in place (`QuickRowEditor`), no
 * buttons on the row — ⌘Return records it, ⌫ discards it, and a click opens what was captured beside the table. A cell
 * still blank says its column's word in grey, with the dashed circle, rather than orange words.
 */

const same = (a: QuickValues, b: QuickValues) => (Object.keys(a) as (keyof QuickValues)[]).every((key) => a[key] === b[key]);

/** Filled blue: ready to record. A dashed ring: something is missing first. Cashflow's circle, read only. */
export function TickCircle({ ready, label = true }: { ready: boolean; label?: boolean }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label ? (ready ? 'Ready to record' : 'Not ready') : undefined}
      aria-hidden={label ? undefined : true}
      data-testid={label ? 'review-tick' : undefined}
      data-ready={ready}
      className={cx(
        'flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full',
        ready ? 'bg-[var(--mac-accent)] text-white' : 'border-[1.5px] border-dashed border-[var(--ph-ink-3)]',
      )}
    >
      {ready && <Check size={10} strokeWidth={3} aria-hidden />}
    </span>
  );
}

/** A capture's cells as its row shows them: the figure in its own currency, the category the row shows (a guess too). */
export function reviewValues(draft: DraftRow, categoryId: string | null, today: string): QuickValues {
  return {
    date: shortDate(draft.occurredOn, today),
    description: draft.description,
    amount: draft.amountMinor !== 0 ? groupedMajorString(Math.abs(draft.amountMinor), draft.currency) : '',
    accountId: draft.accountId ?? '',
    cardId: draft.cardId ?? '',
    categoryId: categoryId ?? '',
  };
}

/** The row's ground: pale blue while its capture is in the peek (v1), the accent in v2, as Cashflow's picked rows. */
const rowGround = (peeked: boolean) =>
  peeked ? (macV2 ? 'bg-[var(--mac-accent)] text-white [&_[data-cell]]:text-white [&_input:focus]:text-[var(--ph-ink)]' : 'rounded-[10px] bg-[var(--mk-sel)] text-[var(--ph-ink)]') : 'text-[var(--ph-ink)]';

/** A press on a row that opens its capture beside the table, not one on a cell's list or the circle. */
const opensPeek = (event: ReactMouseEvent) => !(event.target as HTMLElement).closest('[role="listbox"]');

/** One capture waiting: Cashflow's waiting row, typed in place. */
export function ReviewRow({
  draft,
  ready,
  categoryId,
  guessed,
  options,
  pickedCell,
  peeked,
  busy,
  pendingPaid,
  toCell,
  onPeek,
  onOpen,
  onSave,
  onRecord,
}: {
  draft: DraftRow;
  /** What the circle says: ready to record (`deskState`). */
  ready: boolean;
  /** The category the row shows: its own, else the merchant's history's guess. */
  categoryId: string | null;
  /** Why the category was filled in, when a guess filled it. */
  guessed: string | null;
  options: RowOptions;
  pickedCell: CellPick | null;
  peeked: boolean;
  busy: boolean;
  /** A Paid with pasted in Cashflow that names nothing in cicis yet: shown in the cell, as Cashflow's. */
  pendingPaid: { text: string | null; adds: readonly ComboAdd[] } | null;
  /** A transfer's Category cell: where the money went, its own picker. */
  toCell: ReactNode | null;
  onPeek: () => void;
  onOpen: () => void;
  /** Writes what the cells hold; resolves the capture as it now stands, or null. */
  onSave: (values: QuickValues) => Promise<DraftRow | null>;
  /** ⌘Return: records it as it now stands. */
  onRecord: (draft: DraftRow) => void;
}) {
  const today = isoDate();
  const initial = reviewValues(draft, categoryId, today);
  const [values, setValuesState] = useState(initial);
  // Leaving the row writes it; the cell being left settles its own value in the same moment, so the write reads the
  // newest values from here rather than from a render that has not happened yet.
  const latest = useRef(values);
  const setValues = (next: QuickValues | ((v: QuickValues) => QuickValues)) => {
    latest.current = typeof next === 'function' ? next(latest.current) : next;
    setValuesState(latest.current);
  };
  const initialKey = JSON.stringify(initial);
  // Once a write lands (or the capture changes under it: a guess read, a second sighting merged) the row is read again —
  // unless a cell is being typed in, whose edit stands until the row is left.
  const shownFrom = useRef(initialKey);
  useEffect(() => {
    const was = JSON.parse(shownFrom.current) as QuickValues;
    shownFrom.current = initialKey;
    if (!same(latest.current, was)) return;
    latest.current = JSON.parse(initialKey) as QuickValues;
    setValuesState(latest.current);
  }, [initialKey]);
  const save = () => (same(latest.current, initial) ? Promise.resolve(draft) : onSave(latest.current));

  return (
    <li
      data-testid="draft-row"
      data-draft-id={draft.id}
      data-peek-row={draft.id}
      data-ready={ready}
      aria-current={peeked ? 'true' : undefined}
      onClick={(event) => opensPeek(event) && onPeek()}
      onDoubleClick={(event) => {
        // A double-click in a cell picks a word there; on the row elsewhere it opens the whole draft form.
        if ((event.target as HTMLElement).closest('input')) return;
        onOpen();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (!same(latest.current, initial)) void onSave(latest.current);
      }}
      className={cx('list-none border-b border-[var(--mk-line)] [&_[data-quick-row]]:min-h-[40px]', rowGround(peeked), busy && 'opacity-50')}
    >
      <QuickRowEditor
        layout="desk"
        cellRow={draft.id}
        pickedCell={pickedCell}
        placeholders
        lead={<TickCircle ready={ready} />}
        categoryCell={toCell ?? undefined}
        categoryGuessed={guessed && values.categoryId === categoryId ? guessed : null}
        paidPending={values.accountId ? null : pendingPaid}
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        needs={[]}
        options={options}
        currency={draft.currency}
        className="px-0.5"
        onSubmit={() => void save().then((now) => now && onRecord(now))}
        onCancel={() => setValues(initial)}
        actions={null}
      />
    </li>
  );
}

/** A transfer's Category cell: where the money went, as Review's picker sets it. */
export function ToAccountCell({ draft, accounts, cards, onPick }: { draft: DraftRow; accounts: readonly AccountRow[]; cards: readonly CardRow[]; onPick: (pick: PeekPick) => void }) {
  const to = paidWithOf(draft.toAccountId, null, accounts, cards);
  return (
    <button
      type="button"
      aria-label={`To account for ${draft.description}`}
      onClick={(event) => {
        event.stopPropagation();
        onPick('to');
      }}
      className="flex h-[30px] w-full min-w-0 items-center rounded-[5px] px-2 text-left text-[13px] hover:bg-[var(--mk-pill)]"
    >
      {to ? <span className="truncate">→ {to.name}</span> : <span className="text-[var(--ph-ink-3)]">To account</span>}
    </button>
  );
}

/** A capture recorded or discarded: Cashflow's recorded row, read only (it copies; nothing more). */
export function ResolvedRow({
  draft,
  categoryId,
  accounts,
  cards,
  pickedCell,
  peeked,
  onPeek,
}: {
  draft: DraftRow;
  categoryId: string | null;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  pickedCell: CellPick | null;
  peeked: boolean;
  onPeek: () => void;
}) {
  const today = isoDate();
  const category = categoryId ? accounts.find((a) => a.id === categoryId) : undefined;
  const paid = paidWithOf(draft.accountId, draft.cardId, accounts, cards);
  const to = draft.kind === 'transfer' ? paidWithOf(draft.toAccountId, null, accounts, cards) : null;
  const cell = (column: CellColumn) => cellMarks(column, draft.id, pickedCell);
  const blue = (column: CellColumn) => cellLook(column, pickedCell);
  return (
    <li
      data-testid="resolved-row"
      data-draft-id={draft.id}
      aria-current={peeked ? 'true' : undefined}
      onClick={onPeek}
      className={cx(DESK_GRID, 'min-h-[40px] cursor-default list-none border-b border-[var(--mk-line)] px-0.5 text-[13px]', rowGround(peeked))}
    >
      <span />
      <span {...cell('date')} className={cx('truncate px-2 py-[5px] text-[var(--ph-ink-3)] tabular-nums', blue('date'))}>
        {cellCorner('date', pickedCell)}
        {shortDate(draft.occurredOn, today)}
      </span>
      <span {...cell('description')} className={cx('truncate px-2 py-[5px]', blue('description'))}>
        {cellCorner('description', pickedCell)}
        {draft.description}
      </span>
      <span {...cell('category')} className={cx('flex min-w-0 items-center gap-[6px] px-2 py-[3px]', blue('category'))}>
        {cellCorner('category', pickedCell)}
        {draft.kind === 'transfer' ? (
          <span className="truncate">{to ? `→ ${to.name}` : ''}</span>
        ) : category ? (
          <>
            <CategoryIcon categoryId={category.id} accounts={accounts} size="xs" />
            <span className="truncate">{category.name}</span>
          </>
        ) : null}
      </span>
      <span {...cell('paid')} className={cx('truncate px-2 py-[5px] text-[var(--ph-ink-2)]', blue('paid'))}>
        {cellCorner('paid', pickedCell)}
        {paid ? [paid.name, paid.last4 ? `···· ${paid.last4}` : null].filter(Boolean).join(' ') : ''}
      </span>
      <span {...cell('amount')} className={cx('truncate px-2 py-[5px] text-right tabular-nums', draft.kind === 'income' && 'text-[var(--ph-up)]', blue('amount'))}>
        {cellCorner('amount', pickedCell)}
        {draft.amountMinor !== 0 ? formatMinor(Math.abs(draft.amountMinor), draft.currency) : ''}
      </span>
      <span />
    </li>
  );
}
