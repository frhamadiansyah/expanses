import { categoryPath, matchCategory, matchPayment } from '@expanses/core';
import type { AccountRow, CardRow } from '@expanses/db';
import type { ReactNode } from 'react';
import { isCategoryOf, isMoneyAccount } from '../../lib/queries';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { CellCombo, type ComboOption } from './CellCombo';
import { paymentKey, paymentOptions, type QuickValues } from './quick-row';

/** Date, description, amount, paid with, category, then whatever the row can do. Shared by the list and the table. */
export const ROW_GRID = 'grid grid-cols-[5.5rem_minmax(0,1.6fr)_7.5rem_minmax(0,1.3fr)_minmax(0,1.1fr)_auto] items-center gap-px';

const CELL = 'h-9 w-full rounded-md bg-transparent px-2 text-sm focus:bg-white focus:outline-2 focus:outline-slate-900';
const MISSING = 'bg-amber-50 ring-1 ring-amber-400 ring-inset';

export function useRowOptions(accounts: readonly AccountRow[], cards: readonly CardRow[]) {
  const money = accounts.filter(isMoneyAccount);
  const payments = paymentOptions(money, cards);
  const paid: ComboOption[] = payments.map((option) => ({
    value: paymentKey(option.accountId, option.cardId),
    label: option.accountName,
    meta: option.last4 ?? undefined,
    keywords: option.holderName ?? undefined,
  }));
  const categoryRows = accounts.filter(isCategoryOf('expense'));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const categories: ComboOption[] = categoryRows
    .map((a) => ({
      value: a.id,
      label: a.name,
      meta: a.parentId ? byId.get(a.parentId)?.name : undefined,
      keywords: categoryPath([...accounts], a.id),
      icon: <CategoryIcon categoryId={a.id} accounts={accounts} size="xs" />,
    }))
    .sort((x, y) => (x.keywords ?? '').localeCompare(y.keywords ?? ''));
  const categoryMatch = categoryRows.map((a) => ({ id: a.id, name: a.name, parentName: a.parentId ? (byId.get(a.parentId)?.name ?? null) : null }));
  return {
    paid,
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
  accounts,
  cards,
  actions,
  onSubmit,
  onCancel,
  currency,
  autoFocus = false,
}: {
  values: QuickValues;
  onChange: (patch: Partial<QuickValues>) => void;
  needs: readonly string[];
  accounts: readonly AccountRow[];
  cards: readonly CardRow[];
  actions: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
  currency: string;
  autoFocus?: boolean;
}) {
  const options = useRowOptions(accounts, cards);
  const missing = (cell: string) => needs.includes(cell);
  return (
    <div
      className={cx(ROW_GRID, 'rounded-lg bg-white p-0.5 ring-2 ring-slate-900')}
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
        onChange={(event) => onChange({ date: event.target.value })}
        className={cx(CELL, 'tabular', missing('date') && MISSING)}
      />
      <input
        aria-label="Row description"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="Description"
        value={values.description}
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
        options={options.paid}
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
      <div className="flex items-center gap-1 pl-1">{actions}</div>
    </div>
  );
}
