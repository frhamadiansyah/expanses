import { categoryPath, formatMinor, monthOf, monthRange, isoDate, parseUnits } from '@expanses/core';
import { convertToPurchase, listTransactions, type TransactionView, voidTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import type { TransactionsSearch } from '../../app/router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { formatPoints } from '../cards/useCardPoints';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Select } from '../../ui';
import { classify } from './classify';
import { isEditable } from './draft';
import { useAssetValues, useTrades } from '../networth/queries';
import { useGoals } from '../goals/queries';
import { BillList } from './BillList';
import { BillsDue } from './BillsDue';
import { TransactionForm } from './TransactionForm';

const route = getRouteApi('/transactions');

/** Turns an expense already recorded into the purchase it really was, keeping its date and amount. */
function ConvertForm({
  tx,
  holdings,
  goals,
  onDone,
}: {
  tx: TransactionView;
  holdings: { accountId: string; name: string }[];
  goals: { id: string; name: string }[];
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [accountId, setAccountId] = useState(holdings[0]?.accountId ?? '');
  const [units, setUnits] = useState('');
  const [goalId, setGoalId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await convertToPurchase(database, ws, { transactionId: tx.id, accountId, unitsMicro: parseUnits(units), goalId: goalId || null });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">This was a purchase</h3>
      <p className="text-xs text-slate-500">
        The amount, the date and the account that paid stay as they are. It stops counting as spending and starts counting as a holding.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="What it bought">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {holdings.map((holding) => (
              <option key={holding.accountId} value={holding.accountId}>
                {holding.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Units, shares or grams">
          <Input value={units} inputMode="decimal" onChange={(e) => setUnits(e.target.value)} placeholder="2" />
        </Field>
        {goals.length > 0 && (
          <Field label="For goal">
            <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <ErrorBox error={error} />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || !accountId}>
          Save as a purchase
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

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
  const trades = useTrades();
  const goals = useGoals();
  const values = useAssetValues();
  const holdings = (values.data ?? []).filter((row) => row.mode === 'market');
  const tradeByTransaction = new Map((trades.data ?? []).filter((trade) => trade.transactionId !== null).map((trade) => [trade.transactionId!, trade]));
  const goalName = (goalId: string | null) => (goalId ? ((goals.data ?? []).find((goal) => goal.id === goalId)?.name ?? 'a goal') : null);
  const subtypeOf = new Map(accounts.map((account) => [account.id, account.subtype]));
  /** A transaction touching a person's account is lending, not an ordinary transfer. */
  const isDebt = (tx: TransactionView) => tx.entries.some((entry) => ['receivable', 'payable'].includes(subtypeOf.get(entry.accountId) ?? ''));
  const [converting, setConverting] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const { from, to } = monthRange(month);
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, search.account ?? 'all', month, includeVoid],
    queryFn: () => listTransactions(database, ws, { accountId: search.account, from, to, includeVoid }),
  });
  const purchasePoints = useQuery({
    queryKey: ['purchase-points', ws.workspaceId, (list.data ?? []).map((tx) => tx.id).join(',')],
    enabled: list.isSuccess && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, list.data ?? [], accounts),
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
      <BillsDue />
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
              const label = isDebt(tx)
                ? 'Lend & borrow'
                : c.type === 'transfer'
                  ? 'Transfer'
                  : c.type === 'opening'
                    ? 'Opening balance'
                    : c.categoryIds.map((id) => categoryPath(accounts, id)).join(', ');
              const sign = c.type === 'expense' ? -1 : c.type === 'income' ? 1 : 0;
              if (converting === tx.id) {
                return (
                  <li key={tx.id} className="py-2">
                    <ConvertForm
                      tx={tx}
                      holdings={holdings.map((row) => ({ accountId: row.accountId, name: row.name }))}
                      goals={(goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }))}
                      onDone={() => setConverting(null)}
                    />
                  </li>
                );
              }
              return (
                <li key={tx.id} className={cx('flex items-center gap-3 py-2', tx.status === 'void' && 'opacity-50 line-through')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{tx.description || label}</div>
                    <div className="truncate text-xs text-slate-500">
                      {label} · {c.moneyAccountNames.join(' → ')}
                      {goalName(tradeByTransaction.get(tx.id)?.goalId ?? tx.goalId ?? null) && ` · for ${goalName(tradeByTransaction.get(tx.id)?.goalId ?? tx.goalId ?? null)}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cx('tabular whitespace-nowrap font-medium', sign < 0 && 'text-red-700', sign > 0 && 'text-emerald-700')}>
                      {sign < 0 ? '−' : sign > 0 ? '+' : ''}
                      {formatMinor(c.amountMinor, c.currency)}
                    </div>
                    {purchasePoints.data?.[tx.id] && (
                      <div className={cx('tabular whitespace-nowrap text-xs', purchasePoints.data[tx.id]!.points < 0 ? 'text-red-700' : 'text-emerald-700')}>
                        {purchasePoints.data[tx.id]!.points < 0 ? '−' : purchasePoints.data[tx.id]!.approximate ? '≈ ' : '+'}
                        {formatPoints(Math.abs(purchasePoints.data[tx.id]!.points))} {purchasePoints.data[tx.id]!.unit}
                      </div>
                    )}
                    {tx.originalCurrency && tx.originalAmountMinor !== null && (
                      <div className="tabular whitespace-nowrap text-xs text-slate-500">{formatMinor(tx.originalAmountMinor, tx.originalCurrency)}</div>
                    )}
                  </div>
                  {tradeByTransaction.has(tx.id) ? (
                    <Link to="/net-worth/trades" className="text-sm font-medium text-slate-600 underline" title="Edit this on Buy & sell so units stay in step">
                      Buy &amp; sell
                    </Link>
                  ) : (
                    <>
                      {isEditable(tx) && (
                        <Button variant="ghost" onClick={() => setEditingId(tx.id)}>
                          Edit
                        </Button>
                      )}
                      {tx.status === 'posted' && c.type === 'expense' && holdings.length > 0 && (
                        <Button variant="ghost" onClick={() => setConverting(tx.id)}>
                          This was a purchase
                        </Button>
                      )}
                      {tx.status === 'posted' && (
                        <Button variant="ghost" onClick={() => void onVoid(tx)}>
                          Delete
                        </Button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
      <BillList />
    </div>
  );
}
