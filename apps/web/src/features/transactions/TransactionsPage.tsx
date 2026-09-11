import { categoryPath, formatMinor, monthOf, monthRange, isoDate } from '@expanses/core';
import { listTransactions, type TransactionView, voidTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import type { TransactionsSearch } from '../../app/router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Select } from '../../ui';
import { classify } from './classify';
import { isEditable } from './draft';
import { TransactionForm } from './TransactionForm';

const route = getRouteApi('/transactions');

export function TransactionsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate({ from: '/transactions' });
  const search = route.useSearch();
  const month = search.month ?? monthOf(isoDate());
  const accounts = useAccounts().data ?? [];
  const [includeVoid, setIncludeVoid] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const { from, to } = monthRange(month);
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, search.account ?? 'all', month, includeVoid],
    queryFn: () => listTransactions(database, ws, { accountId: search.account, from, to, includeVoid }),
  });

  async function onVoid(tx: TransactionView) {
    if (!window.confirm(`Delete "${tx.description || 'transaction'}"? It is kept as voided history.`)) return;
    setError(null);
    try {
      await voidTransaction(database, ws, tx.id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const byDate = new Map<string, TransactionView[]>();
  for (const tx of list.data ?? []) byDate.set(tx.occurredOn, [...(byDate.get(tx.occurredOn) ?? []), tx]);

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions" action={!adding && <Button onClick={() => setAdding(true)}>Add transaction</Button>} />
      {adding && <TransactionForm onDone={() => setAdding(false)} />}
      <Card className="grid gap-3 md:grid-cols-3">
        <Field label="Account">
          <Select value={search.account ?? ''} onChange={(e) => void navigate({ search: (s: TransactionsSearch) => ({ ...s, account: e.target.value || undefined }) })}>
            <option value="">All accounts</option>
            {accounts.filter((a) => isMoneyAccount(a) || a.subtype === 'category').map((a) => (
              <option key={a.id} value={a.id}>
                {a.subtype === 'category' ? `Category: ${categoryPath(accounts, a.id)}` : a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Month">
          <Input type="month" value={month} onChange={(e) => void navigate({ search: (s: TransactionsSearch) => ({ ...s, month: e.target.value || undefined }) })} />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} />
          Show deleted
        </label>
      </Card>
      <ErrorBox error={error ?? list.error} />
      {list.isSuccess && list.data.length === 0 && <Empty>No transactions in this period.</Empty>}
      {[...byDate].map(([date, txs]) => (
        <Card key={date}>
          <h2 className="mb-1 text-xs font-semibold text-slate-500">{new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</h2>
          <ul className="divide-y divide-slate-100">
            {txs.map((tx) => {
              if (editingId === tx.id) {
                return (
                  <li key={tx.id} className="py-2">
                    <TransactionForm initial={tx} onDone={() => setEditingId(null)} />
                  </li>
                );
              }
              const c = classify(tx);
              const label = c.type === 'transfer' ? 'Transfer' : c.type === 'opening' ? 'Opening balance' : c.categoryIds.map((id) => categoryPath(accounts, id)).join(', ');
              const sign = c.type === 'expense' ? -1 : c.type === 'income' ? 1 : 0;
              return (
                <li key={tx.id} className={cx('flex items-center gap-3 py-2', tx.status === 'void' && 'opacity-50 line-through')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{tx.description || label}</div>
                    <div className="truncate text-xs text-slate-500">
                      {label} · {c.moneyAccountNames.join(' → ')}
                    </div>
                  </div>
                  <span className={cx('tabular whitespace-nowrap font-medium', sign < 0 && 'text-red-700', sign > 0 && 'text-emerald-700')}>
                    {sign < 0 ? '−' : sign > 0 ? '+' : ''}
                    {formatMinor(c.amountMinor, c.currency)}
                  </span>
                  {isEditable(tx) && (
                    <Button variant="ghost" onClick={() => setEditingId(tx.id)}>
                      Edit
                    </Button>
                  )}
                  {tx.status === 'posted' && (
                    <Button variant="ghost" onClick={() => void onVoid(tx)}>
                      Delete
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
