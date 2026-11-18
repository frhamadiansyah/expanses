import { groupedMajorString, isoDate, parseLooseAmount, parseLooseDate } from '@expanses/core';
import type { AccountRow, CardRow, DraftEdit, DraftRow } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { type CellChange, type CellColumn, type CellTarget, changeLine, planChange, type SkipReason } from '../transactions/cell-range';
import { rememberedCategory } from '../transactions/paste-categories';
import { buildRowOptions } from '../transactions/QuickRowEditor';
import { shortDate } from '../transactions/quick-row';
import { useCellRange } from '../transactions/useCellRange';
import { effectiveCategory } from './capture-view';
import { paidWithOf } from './review-desk-model';

/*
 * Mac Review's blue cells (`cell-range`, owner 2026-11-18): a range down When, Description, Amount, Category or Paid
 * with, over the captures waiting. Each change is written as the table's own cell writes it — a field through the
 * in-place edit, an account through the account pick (which answers for the capture's source too) — and one Undo puts
 * the whole change back by the same paths. Recorded and discarded captures are read only: they copy, nothing more.
 */

/** A capture's cells, as the range reads and writes them. */
export interface ReviewCells {
  occurredOn: string;
  description: string;
  /** Positive, whichever way the money went (`kind` says that). */
  amountMinor: number;
  categoryAccountId: string | null;
  accountId: string | null;
  cardId: string | null;
}

const same = (a: ReviewCells, b: ReviewCells) => (Object.keys(a) as (keyof ReviewCells)[]).every((key) => a[key] === b[key]);

/** The fields a column's cell holds. */
function fieldsOf(cells: ReviewCells, column: CellColumn): Partial<ReviewCells> {
  switch (column) {
    case 'date':
      return { occurredOn: cells.occurredOn };
    case 'description':
      return { description: cells.description };
    case 'amount':
      return { amountMinor: cells.amountMinor };
    case 'category':
      return { categoryAccountId: cells.categoryAccountId };
    case 'paid':
      return { accountId: cells.accountId, cardId: cells.cardId };
  }
}

export function useReviewCells({
  rows,
  pending,
  accounts,
  cards,
  guesses,
  onEdit,
  onPickAccount,
  onStart,
}: {
  /** The table's rows, in its order. */
  rows: readonly DraftRow[];
  /** Whether the table is the queue (To review): only then may a cell change. */
  pending: boolean;
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  guesses: Readonly<Record<string, string | null>> | undefined;
  onEdit: (draft: DraftRow, patch: DraftEdit) => Promise<boolean>;
  onPickAccount: (draft: DraftRow, accountId: string, cardId: string | null) => Promise<boolean>;
  onStart: () => void;
}) {
  const today = isoDate();
  const ids = rows.map((draft) => draft.id);
  const byId = new Map(rows.map((draft) => [draft.id, draft]));
  const options = buildRowOptions(accounts, cards);
  const [note, setNote] = useState<{ text: string; undo: CellChange<ReviewCells>[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<{ column: 'category' | 'paid'; ids: string[] } | null>(null);

  const cellsOf = (draft: DraftRow): ReviewCells => ({
    occurredOn: draft.occurredOn,
    description: draft.description,
    amountMinor: Math.abs(draft.amountMinor),
    categoryAccountId: effectiveCategory(draft, guesses),
    accountId: draft.accountId,
    cardId: draft.cardId,
  });
  const targetOf = (draft: DraftRow): CellTarget<ReviewCells> =>
    pending ? { id: draft.id, draft: true, values: cellsOf(draft), refusal: null } : { id: draft.id, draft: true, values: null, refusal: 'read only' };

  /** A cell's words, as copied: what the table shows, in a form a paste reads back. */
  const textOf = (draft: DraftRow, column: CellColumn): string => {
    switch (column) {
      case 'date':
        return shortDate(draft.occurredOn, today);
      case 'description':
        return draft.description;
      case 'amount':
        return draft.amountMinor ? groupedMajorString(Math.abs(draft.amountMinor), draft.currency) : '';
      case 'category': {
        const id = effectiveCategory(draft, guesses);
        return (id && accounts.find((a) => a.id === id)?.name) || '';
      }
      case 'paid': {
        const paid = paidWithOf(draft.accountId, draft.cardId, accounts, cards);
        return paid ? [paid.name, paid.last4 ?? ''].filter(Boolean).join(' ') : '';
      }
    }
  };

  /** Words put into a capture's cell; null when they do not fit it (a date that is no date, a category of no kind here). */
  const withText = (draft: DraftRow, cells: ReviewCells, column: CellColumn, text: string): ReviewCells | null => {
    const typed = text.trim();
    switch (column) {
      case 'date': {
        const on = parseLooseDate(typed, today);
        return on ? { ...cells, occurredOn: on } : null;
      }
      case 'description':
        return { ...cells, description: typed };
      case 'amount': {
        if (!typed) return { ...cells, amountMinor: 0 };
        const minor = parseLooseAmount(typed, draft.currency);
        return minor === null ? null : { ...cells, amountMinor: minor };
      }
      case 'category': {
        if (!typed) return { ...cells, categoryAccountId: null };
        const remembered = rememberedCategory(typed);
        const offered = (id: string) => options.categories.some((option) => option.value === id);
        const id = options.resolveCategory(typed) ?? (remembered && offered(remembered) ? remembered : null);
        return id ? { ...cells, categoryAccountId: id } : null;
      }
      case 'paid': {
        if (!typed) return { ...cells, accountId: null, cardId: null };
        const key = options.resolvePastedPaid(typed);
        if (!key) return null;
        const [accountId = '', cardId = ''] = key.split(':');
        return { ...cells, accountId, cardId: cardId || null };
      }
    }
  };

  /**
   * Why a capture takes no part in this column's change: a transfer has no category, and a category is spending's or
   * money in's (`kind`, the kind the change is for — none when clearing).
   */
  const unfit = (draft: DraftRow, column: CellColumn, kind: DraftRow['kind'] | null): SkipReason | null => {
    if (column !== 'category') return null;
    if (draft.kind === 'transfer') return 'a transfer';
    return kind && draft.kind !== kind ? 'another kind' : null;
  };

  /** Writes one capture's cells as the table writes a cell: an account by the account pick, the rest by the edit. */
  async function write(draft: DraftRow, before: ReviewCells, after: ReviewCells): Promise<boolean> {
    let ok = true;
    if (after.accountId && (after.accountId !== before.accountId || after.cardId !== before.cardId)) ok = (await onPickAccount(draft, after.accountId, after.cardId)) && ok;
    const patch: DraftEdit = {};
    if (after.occurredOn !== before.occurredOn) patch.occurredOn = after.occurredOn;
    if (after.description !== before.description) patch.description = after.description;
    if (after.amountMinor !== before.amountMinor) patch.amountMinor = draft.kind === 'income' ? -after.amountMinor : after.amountMinor;
    if (after.categoryAccountId !== before.categoryAccountId) patch.categoryAccountId = after.categoryAccountId;
    if (!after.accountId && before.accountId) Object.assign(patch, { accountId: null, cardId: null });
    if (Object.keys(patch).length > 0) ok = (await onEdit(draft, patch)) && ok;
    return ok;
  }

  async function apply(
    column: CellColumn,
    picked: readonly string[],
    next: (cells: ReviewCells, draft: DraftRow) => ReviewCells | null,
    opts: { clearing?: boolean; kind?: DraftRow['kind'] | null } = {},
  ) {
    const drafts = picked.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const targets = drafts.map((draft): CellTarget<ReviewCells> => {
      const target = targetOf(draft);
      const why = target.refusal ? null : (unfit(draft, column, opts.kind ?? null) ?? (opts.clearing && column === 'date' ? 'no empty date' : null));
      return why ? { ...target, values: null, refusal: why } : target;
    });
    const plan = planChange(targets, (cells, id) => next(cells, byId.get(id)!), same);
    setBusy(true);
    const done: CellChange<ReviewCells>[] = [];
    const failed: { id: string; reason: SkipReason }[] = [];
    try {
      for (const change of plan.changes) {
        if (await write(byId.get(change.id)!, change.before, change.after)) done.push(change);
        else failed.push({ id: change.id, reason: 'not saved' });
      }
    } finally {
      setBusy(false);
    }
    setNote({ text: changeLine(done.length, [...plan.skipped, ...failed]), undo: done.length > 0 ? done : null });
  }

  async function undo(changes: readonly CellChange<ReviewCells>[]) {
    setBusy(true);
    try {
      for (const change of [...changes].reverse()) {
        const draft = byId.get(change.id);
        if (draft) await write(draft, change.after, change.before);
      }
    } finally {
      setBusy(false);
    }
    setNote(null);
  }

  const range = useCellRange({
    ids,
    // Review's ⇧-click picks nothing else: from any cell, it stretches the range.
    shiftExtends: () => true,
    onStart: () => {
      setNote(null);
      onStart();
    },
    copyText: (column, picked) => picked.map((id) => textOf(byId.get(id)!, column)).join('\n'),
    onPaste: (column, assignments) => {
      const texts = new Map(assignments.map(({ id, text }) => [id, text]));
      // A category typed or pasted is read among spending's (`resolveCategory`).
      void apply(
        column,
        assignments.map(({ id }) => id),
        (cells, draft) => withText(draft, cells, column, texts.get(draft.id) ?? ''),
        { kind: 'expense' },
      );
    },
    onFill: (column, picked) => {
      const top = byId.get(picked[0]!);
      if (!top) return;
      const from = fieldsOf(cellsOf(top), column);
      void apply(column, picked.slice(1), (cells) => ({ ...cells, ...from }), { kind: top.kind });
    },
    onClear: (column, picked) => void apply(column, picked, (cells, draft) => withText(draft, cells, column, ''), { clearing: true }),
    onPick: (column, picked) => {
      if (column === 'category' || column === 'paid') setPicking({ column, ids: [...picked] });
    },
  });

  /** The one choice for them all: `Picker`'s own sheet, opened on the first capture of the range. */
  const first = picking ? picking.ids.map((id) => byId.get(id)).find((draft) => draft && (picking.column !== 'category' || draft.kind !== 'transfer')) : undefined;
  const choose = picking
    ? {
        draft: first ?? null,
        pick: picking.column === 'category' ? ('category' as const) : ('money' as const),
        count: picking.ids.length,
        close: () => setPicking(null),
        onCategory: (categoryId: string) => {
          const ids = picking.ids;
          setPicking(null);
          void apply('category', ids, (cells) => ({ ...cells, categoryAccountId: categoryId }), { kind: first?.kind ?? 'expense' });
        },
        onAccount: (accountId: string, cardId: string | null) => {
          const ids = picking.ids;
          setPicking(null);
          void apply('paid', ids, (cells) => ({ ...cells, accountId, cardId }));
        },
      }
    : null;

  const line: ReactNode = note ? (
    <p data-testid="cell-change" role="status" className="flex flex-wrap items-center gap-x-[10px] px-[14px] pb-[6px] text-[11.5px] text-[var(--ph-ink-2)]">
      <span>{note.text}</span>
      {note.undo && (
        <button type="button" disabled={busy} onClick={() => void undo(note.undo!)} className="text-[var(--mac-accent)] hover:underline disabled:opacity-50">
          Undo
        </button>
      )}
    </p>
  ) : null;
  const hint = range.active ? `${range.picked.length} cells · ⌘C copies · ⌘V pastes · ⌘D fills down · Return chooses for all · Delete clears` : null;

  return { ...range, busy, line, hint, choose };
}
