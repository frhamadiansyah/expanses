import { groupedMajorString, parseLooseAmount, parseLooseDate } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders } from '../../lib/queries';
import { useCards } from '../cards/card-queries';
import { CategoryPicker } from './CategoryPicker';
import { type CellChange, type CellColumn, type CellTarget, changeLine, planChange, type SkipReason } from './cell-range';
import type { ListRow } from './list-model';
import { rememberedCategory } from './paste-categories';
import { PaymentSheet } from './PaymentSheet';
import type { RowOptions } from './QuickRowEditor';
import { isQuickEditable, paymentOptions, quickFromDraft, quickFromTransaction, type QuickValues, shortDate } from './quick-row';
import type { TableHandlers } from './TransactionsTable';
import { useCellRange } from './useCellRange';

/*
 * Mac Cashflow's blue cells (`cell-range`, owner 2026-11-18): a range down Date, Note, Category, Paid with or Amount,
 * across waiting drafts and recorded rows alike. A draft's cells change as its own cells save it (`saveDraft`, kept as
 * not recorded); a recorded row's as the account table's cells save it (`saveRecorded`) — the same reading, the same
 * set-aside question, the same refusals — and a row the table never lets be changed in cells is skipped, and said.
 * One Undo puts the whole change back, by the same paths.
 */

const same = (a: QuickValues, b: QuickValues) => (Object.keys(a) as (keyof QuickValues)[]).every((key) => a[key] === b[key]);

/** The fields a column's cell holds. */
function fieldsOf(values: QuickValues, column: CellColumn): Partial<QuickValues> {
  switch (column) {
    case 'date':
      return { date: values.date };
    case 'description':
      return { description: values.description };
    case 'amount':
      return { amount: values.amount };
    case 'category':
      return { categoryId: values.categoryId };
    case 'paid':
      return { accountId: values.accountId, cardId: values.cardId };
  }
}

export function useCashflowCells({
  rows,
  today,
  accounts,
  rowOptions,
  handlers,
  saveDraft,
  readOnly,
  onStart,
}: {
  rows: readonly ListRow[];
  today: string;
  accounts: readonly AccountRow[];
  rowOptions: RowOptions;
  handlers: TableHandlers;
  /** A draft's own save (the desk's, which also keeps what a paste taught). */
  saveDraft: TableHandlers['saveDraft'];
  readOnly: boolean;
  onStart: () => void;
}) {
  const cards = useCards().data ?? [];
  const ids = rows.map((row) => row.id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const [note, setNote] = useState<{ text: string; undo: CellChange<QuickValues>[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<{ column: 'category' | 'paid'; ids: string[] } | null>(null);

  /** What a row holds now, or why it cannot take a change here: the account table's own rules for its cells. */
  const targetOf = (row: ListRow): CellTarget<QuickValues> => {
    if (row.kind === 'draft' && row.draft) return { id: row.id, draft: true, values: quickFromDraft(row.draft, today, accounts), refusal: null };
    const tx = row.tx;
    const refuse = (refusal: SkipReason): CellTarget<QuickValues> => ({ id: row.id, draft: false, values: null, refusal });
    if (!tx || readOnly || !handlers.filingKnown || row.deleted || row.instalment || row.sharedTransfer) return refuse('read only');
    if (handlers.elsewhereOf(tx.id)) return refuse('another workspace');
    if (handlers.tradeHoldings.has(tx.id) || handlers.paidByOther?.(tx)) return refuse('read only');
    if (!isQuickEditable(tx)) return refuse('not as cells');
    return { id: row.id, draft: false, values: quickFromTransaction(tx, today), refusal: null };
  };

  /** A cell's words, as copied: what the table shows in it, so a copy pastes back to the same thing. */
  const textOf = (row: ListRow, column: CellColumn): string => {
    switch (column) {
      case 'date':
        return row.date ? shortDate(row.date, today) : row.kind === 'draft' && row.draft ? row.draft.occurredOn : '';
      case 'description':
        return row.description;
      case 'category':
        return row.categoryName ?? '';
      case 'paid':
        return [row.accountLabel, row.last4 ?? ''].filter(Boolean).join(' ');
      case 'amount':
        return row.amountMinor ? groupedMajorString(Math.abs(row.amountMinor), row.currency) : '';
    }
  };

  /** Words put into a cell, read the way a paste into the typing row reads them; null when they do not fit it. */
  const withText = (values: QuickValues, column: CellColumn, text: string): QuickValues | null => {
    const typed = text.trim();
    switch (column) {
      case 'date': {
        if (!typed) return { ...values, date: '' };
        const iso = parseLooseDate(typed, today);
        return iso ? { ...values, date: shortDate(iso, today) } : null;
      }
      case 'description':
        return { ...values, description: typed };
      case 'amount': {
        if (!typed) return { ...values, amount: '' };
        const currency = accounts.find((a) => a.id === values.accountId)?.currency ?? 'IDR';
        return parseLooseAmount(typed, currency) !== null ? { ...values, amount: typed } : null;
      }
      case 'category': {
        if (!typed) return { ...values, categoryId: '' };
        const offered = (id: string) => rowOptions.categories.some((option) => option.value === id);
        const remembered = rememberedCategory(typed);
        const id = rowOptions.resolveCategory(typed) ?? (remembered && offered(remembered) ? remembered : null);
        return id ? { ...values, categoryId: id } : null;
      }
      case 'paid': {
        if (!typed) return { ...values, accountId: '', cardId: '' };
        const key = rowOptions.resolvePastedPaid(typed);
        if (!key) return null;
        const [accountId = '', cardId = ''] = key.split(':');
        return { ...values, accountId, cardId };
      }
    }
  };

  async function apply(picked: readonly string[], next: (values: QuickValues, id: string) => QuickValues | null, opts: { clearing?: boolean } = {}) {
    const targets = picked.flatMap((id) => {
      const row = byId.get(id);
      return row ? [targetOf(row)] : [];
    });
    // A recorded row keeps a cell that is pasted empty: only a draft is cleared.
    const plan = planChange(targets, next, same, opts);
    setBusy(true);
    const done: CellChange<QuickValues>[] = [];
    const failed: { id: string; reason: SkipReason }[] = [];
    try {
      for (const change of plan.changes) {
        // A recorded row's edit replaces it: Undo puts back the row that took its place.
        let now = change.id;
        const ok = change.draft ? await saveDraft(change.id, change.after, false) : await handlers.saveRecorded(change.id, change.after, (replacement) => (now = replacement));
        if (ok) done.push({ ...change, id: now });
        else failed.push({ id: change.id, reason: 'not saved' });
      }
    } finally {
      setBusy(false);
    }
    setNote({ text: changeLine(done.length, [...plan.skipped, ...failed]), undo: done.length > 0 ? done : null });
  }

  async function undo(changes: readonly CellChange<QuickValues>[]) {
    setBusy(true);
    try {
      for (const change of [...changes].reverse()) {
        if (change.draft) await saveDraft(change.id, change.before, false);
        else await handlers.saveRecorded(change.id, change.before);
      }
    } finally {
      setBusy(false);
    }
    setNote(null);
  }

  const cells = useCellRange({
    ids,
    // ⇧-click on a recorded row picks rows, as it always has; a range begun on a draft's cell, or already two cells or
    // more, takes ⇧-click as a spreadsheet does. A drag always picks cells.
    shiftExtends: (range, picked) => picked.length >= 2 || byId.get(range.anchor)?.kind === 'draft',
    onStart: () => {
      setNote(null);
      onStart();
    },
    copyText: (column, picked) => picked.map((id) => textOf(byId.get(id)!, column)).join('\n'),
    onPaste: (column, assignments) => {
      const texts = new Map(assignments.map(({ id, text }) => [id, text]));
      void apply(
        assignments.map(({ id }) => id),
        (values, id) => {
          const text = texts.get(id) ?? '';
          // An empty line pasted over a recorded row's cell leaves it as it is: only a draft's is cleared.
          if (!text.trim() && !byId.get(id)?.draft) return values;
          return withText(values, column, text);
        },
      );
    },
    onFill: (column, picked) => {
      const top = byId.get(picked[0]!);
      if (!top) return;
      const target = targetOf(top);
      const from = target.values ? fieldsOf(target.values, column) : null;
      const text = textOf(top, column);
      void apply(picked.slice(1), (values) => (from ? { ...values, ...from } : withText(values, column, text)));
    },
    onClear: (column, picked) => void apply(picked, (values) => withText(values, column, ''), { clearing: true }),
    onPick: (column, picked) => {
      if (column === 'category' || column === 'paid') setPicking({ column, ids: [...picked] });
    },
    enabled: !readOnly,
  });

  const money = moneyHolders([...accounts]).filter((account) => canPayWith(account));
  const picker: ReactNode = picking ? (
    picking.column === 'category' ? (
      <CategoryPicker
        kind="expense"
        lockKind
        title={`Category for ${picking.ids.length} rows`}
        onPick={(categoryId) => {
          setPicking(null);
          void apply(picking.ids, (values) => ({ ...values, categoryId }));
        }}
        onClose={() => setPicking(null)}
      />
    ) : (
      <PaymentSheet
        title={`Paid with, for ${picking.ids.length} rows`}
        options={paymentOptions(money, cards)}
        accounts={[...accounts]}
        cards
        onPick={(option) => {
          setPicking(null);
          void apply(picking.ids, (values) => ({ ...values, accountId: option.accountId, cardId: option.cardId ?? '' }));
        }}
        onClose={() => setPicking(null)}
      />
    )
  ) : null;

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

  const hint = cells.active ? `${cells.picked.length} cells · ⌘C copies · ⌘V pastes · ⌘D fills down · Return chooses for all · Delete clears drafts` : null;

  return { ...cells, busy, line, picker, hint };
}
