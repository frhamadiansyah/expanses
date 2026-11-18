import { categoryPath, matchCategory, matchPayment, type PaymentOption } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import type { ReactNode } from 'react';
import { moneyHolders } from '../../lib/queries';
import { offeredCategories } from '../categories/offered';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CellCombo, type ComboOption } from './CellCombo';
import { lastFourOf, matchLastFour, payerOptions, paymentKey, type QuickValues } from './quick-row';

/** Date, description, amount, paid with, category, then whatever the row can do. Shared by the list and the table. */
export const ROW_GRID = 'grid grid-cols-[5.5rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_minmax(0,1.1fr)_9.5rem] items-center gap-px';

/**
 * The wide screen's Cashflow table (Mac Cashflow D): Date, Note, Category, Paid with, Counts as, Amount, then what the
 * row can do. The typing row lays its cells out in this order too, so Tab moves along the columns as they read. The
 * columns themselves are the table's to say (`--desk-cols`, one of `DESK_COLUMNS`), so every row narrows at once.
 */
export const DESK_GRID = 'grid grid-cols-[var(--desk-cols)] items-center gap-px';

/**
 * The table's columns: `wide` across the box; `peek` while the side peek takes the right of the page — Counts as is
 * left out (its cells carry `data-col="counts"`, hidden by the table), Note and Category get the room first, Amount is
 * as wide as a figure and no wider, and the last column still holds Record and its ✕ whole.
 */
export const DESK_COLUMNS = {
  wide: '5.5rem minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,1.2fr) 6.5rem 8rem 6rem',
  peek: '4.75rem minmax(0,1.6fr) minmax(0,1.4fr) minmax(0,1fr) 7.25rem 5.75rem',
} as const;

const CELL = 'h-9 w-full rounded-md bg-transparent px-2 text-base md:text-sm focus:bg-white focus:outline-2 focus:outline-slate-900';
const MISSING = 'bg-amber-50 ring-1 ring-amber-400 ring-inset';
/** The desk table's cell: 13 px, as tall as the rows under it, the Mac accent around the one being typed in. */
const DESK_CELL = 'h-[30px] w-full rounded-[5px] bg-transparent px-2 text-[13px] placeholder:text-[var(--ph-ink-3)] focus:bg-white focus:outline-2 focus:outline-[var(--mac-accent)]';

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
  countsAs,
  categoryGuessed,
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
  /** `desk`: the wide Cashflow table's column order (`DESK_GRID`), with a Counts as cell before the amount. */
  layout?: 'row' | 'desk';
  /** What the chosen category counts as, read only: the desk layout's fifth cell. */
  countsAs?: ReactNode;
  /** The category was filled in by a guess (a paste's): why, said on the cell. */
  categoryGuessed?: string | null;
}) {
  const paste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (onPaste?.(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'))) event.preventDefault();
  };
  const missing = (cell: string) => needs.includes(cell);
  const CELL_ = layout === 'desk' ? DESK_CELL : CELL;
  const dense = layout === 'desk';
  const date = (
    <input
      key="date"
      aria-label="Row date"
      autoComplete="off"
      placeholder="Date"
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
      placeholder={layout === 'desk' ? 'Note' : 'Description'}
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
      placeholder="Amount"
      value={values.amount}
      onChange={(event) => onChange({ amount: event.target.value })}
      className={cx(CELL_, 'tabular text-right', missing('amount') && MISSING)}
    />
  );
  const paid = (
    <CellCombo
      key="paid"
      label="Row paid with"
      dense={dense}
      placeholder={layout === 'desk' ? 'Paid with' : 'Name or last digits'}
      value={paymentKey(values.accountId, values.cardId)}
      options={options.paidFor(paymentKey(values.accountId, values.cardId))}
      resolve={options.resolvePaid}
      disabled={!options.ready}
      invalid={missing('paid with')}
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
      placeholder={layout === 'desk' ? 'Category' : 'Search categories'}
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
    <div key="actions" className="flex items-center justify-end gap-1 pl-1">
      {actions}
    </div>
  );
  const cells =
    layout === 'desk'
      ? [
          date,
          description,
          category,
          paid,
          <span key="counts" data-col="counts" className="truncate px-2 text-[13px] text-[var(--ph-ink-3)]">
            {countsAs}
          </span>,
          amount,
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
