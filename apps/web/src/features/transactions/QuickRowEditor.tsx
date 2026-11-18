import { categoryPath, formatMinor, matchCategory, matchPayment, parseLooseAmount, type PaymentOption } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import { type ReactNode, useState } from 'react';
import { moneyHolders } from '../../lib/queries';
import { offeredCategories } from '../categories/offered';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import type { CellColumn } from './cell-range';
import { CellCombo, type ComboOption } from './CellCombo';
import { foldName, lastFourOf, matchLastFour, payerOptions, paymentKey, type QuickValues } from './quick-row';

/** Date, description, amount, paid with, category, then whatever the row can do. Shared by the list and the table. */
export const ROW_GRID = 'grid grid-cols-[5.5rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_minmax(0,1.1fr)_9.5rem] items-center gap-px';

/**
 * The wide screen's Cashflow table (Mac Cashflow D): Date, Note, Category, Paid with, Amount, then what the row can
 * do (what a category counts as is the peek's to say, not a column's). The typing row lays its cells out in this order too, so Tab moves along the columns as they read. The
 * columns themselves are the table's to say (`--desk-cols`, one of `DESK_COLUMNS`), so every row narrows at once.
 */
export const DESK_GRID = 'grid grid-cols-[var(--desk-cols)] items-center gap-px';

/**
 * The table's columns: `wide` across the box; `peek` while the side peek takes the right of the page. Note and
 * Category get the room first, Amount is as wide as a figure and no wider, and the last column holds Record and its ✕
 * whole.
 */
export const DESK_COLUMNS = {
  // Date holds a waiting row's whole "13 Sep 2026".
  wide: '6.5rem minmax(0,2fr) minmax(0,1.7fr) minmax(0,1.2fr) 8rem 6rem',
  peek: '6.25rem minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1fr) 7.25rem 5.75rem',
} as const;

const CELL = 'h-9 w-full rounded-md bg-transparent px-2 text-base md:text-sm focus:bg-white focus:outline-2 focus:outline-slate-900';
const MISSING = 'bg-amber-50 ring-1 ring-amber-400 ring-inset';
/**
 * A cell in a range of blue cells (`useCellRange`): the Mac accent's wash, edged in the accent — only while it is picked
 * (a drag or ⇧-click); a cell at rest, blank or not, is the row's own plain ground.
 */
export const PICKED_CELL = 'bg-[var(--mac-accent-wash)] outline outline-1 -outline-offset-1 outline-[var(--mac-accent)]';
/** The desk table's cell: 13 px, as tall as the rows under it, the Mac accent around the one being typed in. */
const DESK_CELL = 'h-[30px] w-full rounded-[5px] bg-transparent px-2 text-[13px] placeholder:text-[var(--ph-ink-3)] focus:bg-[var(--ph-surface)] focus:outline-2 focus:outline-[var(--mac-accent)]';
/**
 * A waiting row's cells read in the recorded rows' own colours (Mac Cashflow option E): the date grey, Paid with in the
 * second ink, the rest in ink. Set on the cell, which its field takes (`color: inherit`), so a picked row can turn it white.
 */
const DESK_TONE: Partial<Record<CellColumn, string>> = { date: 'text-[var(--ph-ink-3)]', paid: 'text-[var(--ph-ink-2)]' };

export type RowOptions = ReturnType<typeof buildRowOptions>;

/**
 * The choices for the paid-with and category cells. Built once per list, not once per row. Categories are narrowed
 * by `offeredCategories` — the app's one category filter, so the cell offers exactly what `CategoryPicker` offers;
 * money accounts are never narrowed, because one bank account pays for every book.
 */
export function buildRowOptions(
  accounts: readonly AccountRow[],
  cards: readonly CardRow[],
  inOpenBook: (a: AccountRow) => boolean = () => true,
  /** Which categories belong to a category set. They belong to an event (§6), so no picker offers them. */
  membership: Record<string, unknown> = {},
  /** False while the queries these lists come from are still loading; the cells wait rather than offer nothing. */
  ready = true,
  /** The digits an account with no card shows beside its name (a bank account's number, a wallet's phone), by account. */
  numbers: Readonly<Record<string, string>> = {},
) {
  const money = moneyHolders(accounts);
  const toCombo = (option: PaymentOption): ComboOption => ({
    value: paymentKey(option.accountId, option.cardId),
    label: option.accountName,
    meta: option.last4 ?? undefined,
    keywords: option.holderName ?? undefined,
  });
  // The cell says what paid, so it offers only what can: never a locked deposit, never a house.
  const payments = payerOptions(money, cards, '');
  const paid: ComboOption[] = payments.map(toCombo);
  const categoryRows = offeredCategories(accounts, 'expense', membership, inOpenBook);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const categories: ComboOption[] = categoryRows
    .map((a) => ({
      value: a.id,
      label: a.name,
      detail: a.parentId ? byId.get(a.parentId)?.name : undefined,
      keywords: categoryPath([...accounts], a.id),
      icon: <CategoryIcon categoryId={a.id} accounts={accounts} size="xs" />,
    }))
    .sort((x, y) => (x.keywords ?? '').localeCompare(y.keywords ?? ''));
  const categoryMatch = categoryRows.map((a) => ({ id: a.id, name: a.name, parentName: a.parentId ? (byId.get(a.parentId)?.name ?? null) : null }));
  const foldedMatch = categoryMatch.map((o) => ({ ...o, name: foldName(o.name), parentName: o.parentName === null ? null : foldName(o.parentName) }));
  return {
    ready,
    /**
     * The paid-with list for one row. Built here rather than handed over whole, because what a row may offer
     * depends on what it already names: a purchase recorded against a house still has to show the house, and one
     * recorded against a card account with no card named still has to show that account. `key` is a `paymentKey`.
     */
    paidFor: (key: string): ComboOption[] => (key && !paid.some((option) => option.value === key) ? payerOptions(money, cards, key).map(toCombo) : paid),
    categories,
    resolvePaid: (text: string) => {
      const hit = matchPayment(text, payments);
      return hit ? paymentKey(hit.accountId, hit.cardId) : null;
    },
    resolveCategory: (text: string) => matchCategory(text, categoryMatch),
    /**
     * A pasted Category cell (the wide table's paste, and a range of its cells): as typed, else with accents left out
     * and "&" read as "and" on both sides (`foldName`) — "Cafe" names "Café", "Food and Drink" names "Food & Drink".
     */
    resolvePastedCategory: (text: string) => matchCategory(text, categoryMatch) ?? matchCategory(foldName(text), foldedMatch),
    /**
     * A pasted Paid with cell (the wide table's paste, and a range of its cells): four digits — bare or after a mask —
     * name the one card or account showing them (`matchLastFour`), else nothing; any other text reads as a typed one.
     */
    resolvePastedPaid: (text: string) => {
      const four = lastFourOf(text);
      if (four) return matchLastFour(four, payments, numbers);
      const hit = matchPayment(text, payments);
      return hit ? paymentKey(hit.accountId, hit.cardId) : null;
    },
  };
}

export function QuickRowEditor({
  values,
  onChange,
  needs,
  options,
  actions,
  onSubmit,
  onCancel,
  currency,
  autoFocus = false,
  className,
  onDescriptionBlur,
  onPaste,
  layout = 'row',
  categoryGuessed,
  paidGuessed,
  cellRow,
  pickedCell,
}: {
  values: QuickValues;
  onChange: (patch: Partial<QuickValues>) => void;
  needs: readonly string[];
  options: RowOptions;
  actions: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
  currency: string;
  autoFocus?: boolean;
  /** Replaces the editing frame, for a row that sits among others in the table. */
  className?: string;
  onDescriptionBlur?: () => void;
  /** Handed text (and its HTML, when the clipboard has some) pasted into the date or description cell; true when taken as rows. */
  onPaste?: (text: string, html: string) => boolean;
  /** `desk`: the wide Cashflow table's column order (`DESK_GRID`). */
  layout?: 'row' | 'desk';
  /** The category was filled in by a guess (a paste's): why, said on the cell. */
  categoryGuessed?: string | null;
  /** Paid with was filled in from what this device remembers of a paste's cell: why, said on the cell. */
  paidGuessed?: string | null;
  /**
   * A desk row's id, which marks each of its cells for a range of blue cells (`useCellRange`): `data-cell` and
   * `data-cell-row` on the cell. Left out on the typing row, which is no part of a range.
   */
  cellRow?: string;
  /** The column of this row's cell in a range of blue cells, if one is. */
  pickedCell?: CellColumn | null;
}) {
  const paste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (onPaste?.(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'))) event.preventDefault();
  };
  // The desk marks no cell as missing (option E): a blank cell is just blank, and Record stays grey until none is.
  const missing = (cell: string) => layout !== 'desk' && needs.includes(cell);
  const CELL_ = layout === 'desk' ? DESK_CELL : CELL;
  const dense = layout === 'desk';
  // A row of the table (not the typing row): no word in a blank cell, and its figure read as the recorded rows print it
  // ("Rp 320.000") until the cell is typed in.
  const inTable = layout === 'desk' && !!cellRow;
  const hint = (word: string) => (inTable ? undefined : word);
  const [amountFocused, setAmountFocused] = useState(false);
  const amountMinor = inTable && !amountFocused ? parseLooseAmount(values.amount, currency) : null;
  const amountShown = amountMinor !== null && values.amount.trim() !== '' ? formatMinor(amountMinor, currency) : values.amount;
  const date = (
    <input
      key="date"
      aria-label="Row date"
      autoComplete="off"
      placeholder={hint('Date')}
      value={values.date}
      onPaste={paste}
      onChange={(event) => onChange({ date: event.target.value })}
      className={cx(CELL_, 'tabular', missing('date') && MISSING)}
    />
  );
  const description = (
    <input
      key="description"
      aria-label="Row description"
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={layout === 'desk' ? hint('Note') : 'Description'}
      value={values.description}
      onPaste={paste}
      onBlur={onDescriptionBlur}
      onChange={(event) => onChange({ description: event.target.value })}
      className={cx(CELL_, missing('description') && MISSING)}
    />
  );
  const amount = (
    <input
      key="amount"
      aria-label={`Row amount (${currency})`}
      autoComplete="off"
      inputMode="decimal"
      placeholder={hint('Amount')}
      value={amountShown}
      onFocus={() => setAmountFocused(true)}
      onBlur={() => setAmountFocused(false)}
      onChange={(event) => onChange({ amount: event.target.value })}
      className={cx(CELL_, 'tabular text-right', missing('amount') && MISSING)}
    />
  );
  const paid = (
    <CellCombo
      key="paid"
      label="Row paid with"
      dense={dense}
      placeholder={layout === 'desk' ? hint('Paid with') : 'Name or last digits'}
      value={paymentKey(values.accountId, values.cardId)}
      options={options.paidFor(paymentKey(values.accountId, values.cardId))}
      resolve={options.resolvePaid}
      disabled={!options.ready}
      invalid={missing('paid with')}
      guessed={paidGuessed}
      onChange={(key) => {
        const [accountId = '', cardId = ''] = key.split(':');
        onChange({ accountId, cardId });
      }}
    />
  );
  const category = (
    <CellCombo
      key="category"
      label="Row category"
      dense={dense}
      placeholder={layout === 'desk' ? hint('Category') : 'Search categories'}
      value={values.categoryId}
      options={options.categories}
      resolve={options.resolveCategory}
      disabled={!options.ready}
      invalid={missing('category')}
      guessed={categoryGuessed}
      onChange={(categoryId) => onChange({ categoryId })}
    />
  );
  const ends = (
    <div key="actions" className={cx('flex items-center gap-1 pl-1', layout === 'desk' ? 'justify-start' : 'justify-end')}>
      {actions}
    </div>
  );
  // A desk row's cells are marked for a range of blue cells, and drawn blue while in one.
  const cell = (column: CellColumn, node: ReactNode) =>
    layout === 'desk' && cellRow ? (
      <div key={column} data-cell={column} data-cell-row={cellRow} data-picked={pickedCell === column || undefined} className={cx('min-w-0 rounded-[5px]', DESK_TONE[column], pickedCell === column && PICKED_CELL)}>
        {node}
      </div>
    ) : (
      node
    );
  const cells =
    layout === 'desk'
      ? [
          cell('date', date),
          cell('description', description),
          cell('category', category),
          cell('paid', paid),
          cell('amount', amount),
          ends,
        ]
      : [date, description, amount, paid, category, ends];
  return (
    <div
      className={cx(layout === 'desk' ? DESK_GRID : ROW_GRID, className ?? 'rounded-lg bg-white p-0.5 ring-2 ring-slate-900')}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
          event.preventDefault();
          onSubmit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      {cells}
    </div>
  );
}
