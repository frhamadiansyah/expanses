import { categoryPath, matchCategory, matchPayment, type PaymentOption } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import type { ReactNode } from 'react';
import { categoryChoices, isMoneyAccount } from '../../lib/queries';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CellCombo, type ComboOption } from './CellCombo';
import { payerOptions, paymentKey, type QuickValues } from './quick-row';

/** Date, description, amount, paid with, category, then whatever the row can do. Shared by the list and the table. */
export const ROW_GRID = 'grid grid-cols-[5.5rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_minmax(0,1.1fr)_9.5rem] items-center gap-px';

const CELL = 'h-9 w-full rounded-md bg-transparent px-2 text-base md:text-sm focus:bg-white focus:outline-2 focus:outline-slate-900';
const MISSING = 'bg-amber-50 ring-1 ring-amber-400 ring-inset';

export type RowOptions = ReturnType<typeof buildRowOptions>;

/**
 * The choices for the paid-with and category cells. Built once per list, not once per row. Categories are narrowed
 * by `inOpenBook` (the open book's); money accounts never are.
 */
export function buildRowOptions(accounts: readonly AccountRow[], cards: readonly CardRow[], inOpenBook: (a: AccountRow) => boolean = () => true) {
  const money = accounts.filter(isMoneyAccount);
  const toCombo = (option: PaymentOption): ComboOption => ({
    value: paymentKey(option.accountId, option.cardId),
    label: option.accountName,
    meta: option.last4 ?? undefined,
    keywords: option.holderName ?? undefined,
  });
  // The cell says what paid, so it offers only what can: never a locked deposit, never a house.
  const payments = payerOptions(money, cards, '');
  const paid: ComboOption[] = payments.map(toCombo);
  const categoryRows = categoryChoices(accounts, 'expense', inOpenBook);
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
    /**
     * The paid-with list for one row. Built here rather than handed over whole, because what a row may offer
     * depends on what it already names: a purchase recorded against a house still has to show the house.
     */
    paidFor: (accountId: string): ComboOption[] => (accountId && !paid.some((option) => option.value.split(':')[0] === accountId) ? payerOptions(money, cards, accountId).map(toCombo) : paid),
    categories,
    resolvePaid: (text: string) => {
      const hit = matchPayment(text, payments);
      return hit ? paymentKey(hit.accountId, hit.cardId) : null;
    },
    resolveCategory: (text: string) => matchCategory(text, categoryMatch),
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
  /** Handed text pasted into the date or description cell; return true when it was taken as rows. */
  onPaste?: (text: string) => boolean;
}) {
  const paste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (onPaste?.(event.clipboardData.getData('text/plain'))) event.preventDefault();
  };
  const missing = (cell: string) => needs.includes(cell);
  return (
    <div
      className={cx(ROW_GRID, className ?? 'rounded-lg bg-white p-0.5 ring-2 ring-slate-900')}
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
      <input
        aria-label="Row date"
        autoComplete="off"
        placeholder="15 Sep"
        value={values.date}
        onPaste={paste}
        onChange={(event) => onChange({ date: event.target.value })}
        className={cx(CELL, 'tabular', missing('date') && MISSING)}
      />
      <input
        aria-label="Row description"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Description"
        value={values.description}
        onPaste={paste}
        onBlur={onDescriptionBlur}
        onChange={(event) => onChange({ description: event.target.value })}
        className={cx(CELL, missing('description') && MISSING)}
      />
      <input
        aria-label={`Row amount (${currency})`}
        autoComplete="off"
        inputMode="decimal"
        placeholder="0"
        value={values.amount}
        onChange={(event) => onChange({ amount: event.target.value })}
        className={cx(CELL, 'tabular text-right', missing('amount') && MISSING)}
      />
      <CellCombo
        label="Row paid with"
        placeholder="Name or last 4 digits"
        value={paymentKey(values.accountId, values.cardId)}
        options={options.paidFor(values.accountId)}
        resolve={options.resolvePaid}
        invalid={missing('paid with')}
        onChange={(key) => {
          const [accountId = '', cardId = ''] = key.split(':');
          onChange({ accountId, cardId });
        }}
      />
      <CellCombo
        label="Row category"
        placeholder="Search categories"
        value={values.categoryId}
        options={options.categories}
        resolve={options.resolveCategory}
        invalid={missing('category')}
        onChange={(categoryId) => onChange({ categoryId })}
      />
      <div className="flex items-center justify-end gap-1 pl-1">{actions}</div>
    </div>
  );
}
