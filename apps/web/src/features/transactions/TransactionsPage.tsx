import { categoryPath, formatMinor, isoDate, monthOf, monthRange, parseUnits } from '@expanses/core';
import { confirmDraft, convertToPurchase, listTransactions, type TransactionView, voidTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { CircleAlert, CalendarX2, Search, X } from 'lucide-react';
import type { TransactionsSearch } from '../../app/router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { isCategoryOf, isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCards } from '../cards/card-queries';
import { formatPoints } from '../cards/useCardPoints';
import { useDrafts } from '../review/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader, Select } from '../../ui';
import { ChipMenu, type ChipOption } from './ChipMenu';
import { isEditable } from './draft';
import { buildRows, dayTotal, EMPTY_FILTERS, filterRows, groupByDay, type ListFilters, type ListRow, type Sort, sortRows, totals } from './list-model';
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** All time reads a longer stretch than one month does; past this many the oldest are left out. */
const ALL_TIME_LIMIT = 5000;

const SORTS: { value: string; label: string; short: string }[] = [
  { value: 'date:desc', label: 'Newest first', short: 'Newest' },
  { value: 'date:asc', label: 'Oldest first', short: 'Oldest' },
  { value: 'amount:desc', label: 'Largest amount', short: 'Largest' },
  { value: 'amount:asc', label: 'Smallest amount', short: 'Smallest' },
];

const TYPES: { value: ListFilters['type']; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfers & lending' },
];

/** The last two years of months, newest first, plus whichever month the address asked for. */
function monthOptions(current: string): ChipOption[] {
  const today = new Date();
  const months: string[] = [];
  for (let i = 0; i < 24; i += 1) months.push(monthOf(isoDate(new Date(today.getFullYear(), today.getMonth() - i, 1))));
  if (current !== 'all' && !months.includes(current)) months.push(current);
  return [{ value: 'all', label: 'All time' }, ...months.map((month) => ({ value: month, label: monthLabel(month) }))];
}

function DayHeader({ date, net, currency }: { date: string; net: number; currency: string }) {
  if (!date) {
    return (
      <div className="flex items-center gap-2.5 border-b border-slate-200 pb-2">
        <CalendarX2 size={22} className="text-amber-700" aria-hidden />
        <span className="flex flex-col text-xs leading-tight text-slate-500">
          <b className="font-semibold text-slate-700">No date yet</b>
          Give these a date to file them
        </span>
      </div>
    );
  }
  const d = new Date(`${date}T00:00:00`);
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-200 pb-2">
      <span className="tabular min-w-8 text-2xl font-semibold leading-none">{d.getDate()}</span>
      <span className="flex flex-col text-xs leading-tight text-slate-500">
        <b className="font-semibold text-slate-700">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
        {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </span>
      {net !== 0 && (
        <span className={cx('tabular ml-auto text-sm font-semibold', net < 0 ? 'text-red-700' : 'text-emerald-700')}>
          {net < 0 ? '−' : '+'}
          {formatMinor(Math.abs(net), currency)}
        </span>
      )}
    </div>
  );
}

export function TransactionsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate({ from: '/transactions' });
  const search = route.useSearch();
  const month = search.month ?? monthOf(isoDate());
  const accounts = useAccounts().data ?? [];
  const cards = useCards().data ?? [];
  const drafts = useDrafts();
  const [filters, setFilters] = useState<Omit<ListFilters, 'month'>>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const trades = useTrades();
  const goals = useGoals();
  const values = useAssetValues();
  const holdings = (values.data ?? []).filter((row) => row.mode === 'market');
  const tradeByTransaction = new Map((trades.data ?? []).filter((trade) => trade.transactionId !== null).map((trade) => [trade.transactionId!, trade]));
  const goalName = (goalId: string | null) => (goalId ? ((goals.data ?? []).find((goal) => goal.id === goalId)?.name ?? 'a goal') : null);
  const [converting, setConverting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const setSearch = (patch: Partial<TransactionsSearch>) => void navigate({ search: (s: TransactionsSearch) => ({ ...s, ...patch }) });

  const range = month === 'all' ? {} : monthRange(month);
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, search.account ?? 'all', month, filters.showDeleted],
    queryFn: () => listTransactions(database, ws, { accountId: search.account, ...range, includeVoid: filters.showDeleted, limit: month === 'all' ? ALL_TIME_LIMIT : undefined }),
  });
  const purchasePoints = useQuery({
    queryKey: ['purchase-points', ws.workspaceId, (list.data ?? []).map((tx) => tx.id).join(',')],
    enabled: list.isSuccess && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, list.data ?? [], accounts),
  });

  // A page opened for one account or category shows only the drafts that touch it.
  const pending = (drafts.data ?? []).filter((draft) => !search.account || draft.accountId === search.account || draft.categoryAccountId === search.account);
  const rows = buildRows(list.data ?? [], pending, accounts, cards);
  const shown = sortRows(filterRows(rows, { ...filters, month }, accounts), sort);
  const sum = totals(shown);

  const money = accounts.filter(isMoneyAccount);
  const cardsOf = (accountId: string) => cards.filter((card) => card.accountId === accountId);
  const paidOptions: ChipOption[] = [
    { value: '', label: 'Any account' },
    ...money.flatMap((account) => {
      const own = cardsOf(account.id);
      const whole: ChipOption = { value: `acct:${account.id}`, label: account.name, meta: own.length === 1 && own[0]!.last4 ? `···· ${own[0]!.last4}` : undefined };
      if (own.length < 2) return [whole];
      return [
        { ...whole, meta: 'all cards' },
        ...own.map((card) => ({ value: `card:${card.id}`, label: card.holderName ?? account.name, meta: card.last4 ? `···· ${card.last4}` : undefined, keywords: account.name, indent: true })),
      ];
    }),
  ];
  const categoryOptions: ChipOption[] = [
    { value: '', label: 'Any category' },
    ...accounts
      .filter((a) => isCategoryOf('expense')(a) || isCategoryOf('income')(a))
      .map((a) => ({ value: a.id, label: categoryPath(accounts, a.id), icon: <CategoryIcon categoryId={a.id} accounts={accounts} size="xs" />, indent: a.parentId !== null }))
      .sort((x, y) => x.label.localeCompare(y.label)),
  ];
  const paidPicked = paidOptions.find((option) => option.value === filters.paid && option.value);
  const scope = search.account ? accounts.find((a) => a.id === search.account) : undefined;
  const sortValue = `${sort.key}:${sort.dir}`;
  const narrowed = filters.q || filters.paid || filters.cat || filters.type !== 'all' || filters.showDeleted || filters.onlyDrafts || sortValue !== 'date:desc' || search.month || search.account;

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSort({ key: 'date', dir: 'desc' });
    setSearch({ month: undefined, account: undefined });
  }

  async function run(id: string, work: () => Promise<unknown>) {
    setError(null);
    setBusy(id);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onVoid(tx: TransactionView) {
    if (!window.confirm(`Delete "${tx.description || 'transaction'}"? It is kept as voided history.`)) return;
    await run(tx.id, () => voidTransaction(database, ws, tx.id));
  }

  function draftRow(row: ListRow) {
    const complete = row.needs.length === 0;
    return (
      <li key={row.id} data-testid="not-recorded-row" className="-mx-2 flex items-center gap-3 rounded-lg bg-amber-50 px-2 py-2 shadow-[inset_3px_0_0_#f59e0b]">
        {row.categoryId ? (
          <CategoryIcon categoryId={row.categoryId} accounts={accounts} />
        ) : (
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden>
            <CircleAlert size={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.description || 'No description yet'}</div>
          <div className="truncate text-xs text-slate-500">
            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">Not recorded</span>
            {!complete && <span className="text-amber-800"> needs {row.needs.join(' & ')}</span>}
            {row.categoryName && ` · ${row.categoryName}`}
            {row.accountLabel && ` · ${row.accountLabel}`}
            {row.last4 && <span className="tabular font-semibold text-slate-600"> ···· {row.last4}</span>}
          </div>
        </div>
        <div className="tabular whitespace-nowrap text-right font-medium text-slate-500">{row.amountMinor > 0 ? formatMinor(row.amountMinor, row.currency) : '—'}</div>
        {complete ? (
          <Button
            className="py-1.5"
            disabled={busy === row.id}
            aria-label={`Record ${row.description}`}
            onClick={() => void run(row.id, () => confirmDraft(database, ws, row.id))}
          >
            Record
          </Button>
        ) : (
          <Link to="/review" className="rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 underline hover:bg-amber-100">
            Finish
          </Link>
        )}
      </li>
    );
  }

  function recordedRow(row: ListRow, withDate: boolean) {
    const tx = row.tx!;
    if (editingId === tx.id) {
      return (
        <li key={tx.id} className="py-2">
          <TransactionForm initial={tx} onDone={() => setEditingId(null)} />
        </li>
      );
    }
    if (converting === tx.id) {
      return (
        <li key={tx.id} className="py-2">
          <ConvertForm
            tx={tx}
            holdings={holdings.map((holding) => ({ accountId: holding.accountId, name: holding.name }))}
            goals={(goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }))}
            onDone={() => setConverting(null)}
          />
        </li>
      );
    }
    const label =
      row.type === 'debt'
        ? 'Lend & borrow'
        : row.type === 'transfer'
          ? 'Transfer'
          : row.type === 'opening'
            ? 'Opening balance'
            : (row.tx!.entries.filter((e) => e.accountKind === row.type).map((e) => categoryPath(accounts, e.accountId)).join(', '));
    const sign = row.type === 'expense' ? -1 : row.type === 'income' ? 1 : 0;
    const goal = goalName(tradeByTransaction.get(tx.id)?.goalId ?? tx.goalId ?? null);
    const points = purchasePoints.data?.[tx.id];
    return (
      <li key={tx.id} className={cx('flex items-center gap-3 py-2', row.deleted && 'opacity-50 line-through')}>
        <span className={cx(row.deleted && 'grayscale')}>
          <CategoryIcon categoryId={row.categoryId} accounts={accounts} transfer={row.type !== 'expense' && row.type !== 'income'} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {withDate && <span className="tabular mr-2 font-normal text-slate-500">{new Date(`${row.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
            {tx.description || label}
          </div>
          <div className="truncate text-xs text-slate-500">
            {label} · {row.accountLabel}
            {row.last4 && <span className="tabular font-semibold text-slate-600"> ···· {row.last4}</span>}
            {goal && ` · for ${goal}`}
          </div>
        </div>
        <div className="text-right">
          <div className={cx('tabular whitespace-nowrap font-medium', sign < 0 && 'text-red-700', sign > 0 && 'text-emerald-700')}>
            {sign < 0 ? '−' : sign > 0 ? '+' : ''}
            {formatMinor(row.amountMinor, row.currency)}
          </div>
          {points && (
            <div className={cx('tabular whitespace-nowrap text-xs', points.points < 0 ? 'text-red-700' : 'text-emerald-700')}>
              {points.points < 0 ? '−' : points.approximate ? '≈ ' : '+'}
              {formatPoints(Math.abs(points.points))} {points.unit}
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
            {tx.status === 'posted' && row.type === 'expense' && holdings.length > 0 && (
              <Button variant="ghost" onClick={() => setConverting(tx.id)}>
                This was a purchase
              </Button>
            )}
            {tx.status === 'posted' && (
              <Button variant="ghost" disabled={busy === tx.id} onClick={() => void onVoid(tx)}>
                Delete
              </Button>
            )}
          </>
        )}
      </li>
    );
  }

  const rowView = (row: ListRow, withDate = false) => (row.kind === 'draft' ? draftRow(row) : recordedRow(row, withDate));

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions" action={!adding && <Button onClick={() => setAdding(true)}>Add transaction</Button>} />
      {adding && <TransactionForm onDone={() => setAdding(false)} />}
      <BillsDue />

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-52 flex-[1_1_280px]">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={filters.q}
              onChange={(event) => setFilter('q', event.target.value)}
              placeholder="Search description, category, card digits or amount"
              aria-label="Search transactions"
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-2.5 pl-8 text-sm focus:border-slate-900 focus:outline-none"
            />
          </label>
          {pending.length > 0 && (
            <button
              type="button"
              aria-pressed={filters.onlyDrafts}
              title={filters.onlyDrafts ? 'Show everything again' : 'Show only rows not recorded yet'}
              onClick={() => setFilter('onlyDrafts', !filters.onlyDrafts)}
              className={cx(
                'inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold ring-1',
                filters.onlyDrafts ? 'bg-amber-700 text-white ring-amber-700' : 'bg-amber-50 text-amber-800 ring-amber-300 hover:bg-amber-100',
              )}
            >
              <CircleAlert size={16} aria-hidden />
              {pending.length} not recorded
            </button>
          )}
          {scope && (
            <span className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 pr-1 pl-2.5 text-sm text-slate-300">
              Only <b className="font-semibold text-white">{scope.subtype === 'category' ? categoryPath(accounts, scope.id) : scope.name}</b>
              <button type="button" aria-label="Show every account" onClick={() => setSearch({ account: undefined })} className="rounded p-1 hover:bg-slate-700">
                <X size={14} aria-hidden />
              </button>
            </span>
          )}
          <ChipMenu
            name="Month"
            value={month}
            active={false}
            options={monthOptions(month)}
            onPick={(value) => setSearch({ month: value === monthOf(isoDate()) ? undefined : value })}
            shown={
              <>
                Month <b className="font-semibold text-slate-900">{month === 'all' ? 'All time' : monthLabel(month)}</b>
              </>
            }
          />
          <ChipMenu
            name="Paid with"
            value={filters.paid}
            active={Boolean(paidPicked)}
            searchable
            options={paidOptions}
            onPick={(value) => setFilter('paid', value)}
            shown={paidPicked && <b className="truncate font-semibold text-white">{`${paidPicked.label}${paidPicked.meta && paidPicked.meta !== 'all cards' ? ` ${paidPicked.meta}` : ''}`}</b>}
          />
          <ChipMenu
            name="Category"
            value={filters.cat}
            active={Boolean(filters.cat)}
            searchable
            options={categoryOptions}
            onPick={(value) => setFilter('cat', value)}
            shown={filters.cat && <b className="truncate font-semibold text-white">{accounts.find((a) => a.id === filters.cat)?.name}</b>}
          />
          <ChipMenu
            name="Type"
            value={filters.type}
            active={filters.type !== 'all'}
            options={TYPES}
            onPick={(value) => setFilter('type', value as ListFilters['type'])}
            shown={filters.type !== 'all' && <b className="font-semibold text-white">{TYPES.find((t) => t.value === filters.type)?.label}</b>}
          />
          <ChipMenu
            name="Sort"
            value={sortValue}
            active={sortValue !== 'date:desc'}
            options={SORTS}
            onPick={(value) => {
              const [key, dir] = value.split(':') as [Sort['key'], Sort['dir']];
              setSort({ key, dir });
            }}
            shown={
              <>
                Sort <b className={cx('font-semibold', sortValue !== 'date:desc' ? 'text-white' : 'text-slate-900')}>{SORTS.find((s) => s.value === sortValue)?.short}</b>
              </>
            }
          />
          <label className="inline-flex items-center gap-1.5 px-1 text-sm text-slate-700">
            <input type="checkbox" checked={filters.showDeleted} onChange={(event) => setFilter('showDeleted', event.target.checked)} />
            Show deleted
          </label>
          {narrowed && (
            <button type="button" onClick={clearAll} className="px-1.5 py-1 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">
              Clear
            </button>
          )}
        </div>
        <p className="px-0.5 text-xs text-slate-500" aria-live="polite">
          <b className="font-semibold text-slate-900">{sum.count}</b> transaction{sum.count === 1 ? '' : 's'}
          {sum.spentMinor > 0 && (
            <>
              {' · '}
              <b className="font-semibold text-slate-900">{formatMinor(sum.spentMinor, ws.baseCurrency)}</b> spent
            </>
          )}
          {sum.incomeMinor > 0 && (
            <>
              {' · '}
              <b className="font-semibold text-slate-900">{formatMinor(sum.incomeMinor, ws.baseCurrency)}</b> in
            </>
          )}
          {month === 'all' && (list.data?.length ?? 0) >= ALL_TIME_LIMIT && ` · the newest ${ALL_TIME_LIMIT.toLocaleString('en-GB')} only`}
        </p>
      </div>

      <ErrorBox error={error ?? list.error ?? drafts.error} />
      {list.isSuccess && shown.length === 0 &&
        (rows.length === 0 ? (
          <Empty>No transactions in this period.</Empty>
        ) : (
          <Empty>
            Nothing matches{filters.q && ` “${filters.q}”`}.{' '}
            <button type="button" onClick={clearAll} className="underline">
              Clear search and filters
            </button>
          </Empty>
        ))}

      {sort.key === 'amount' && shown.length > 0 ? (
        <>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 py-0.5 pr-1 pl-3 text-xs text-slate-700">
            Sorted by amount, {sort.dir === 'asc' ? 'smallest' : 'largest'} first
            <button type="button" onClick={() => setSort({ key: 'date', dir: 'desc' })} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-slate-300 hover:bg-slate-900 hover:text-white">
              Back to dates
            </button>
          </div>
          <Card>
            <ul className="divide-y divide-slate-100">{shown.map((row) => rowView(row, true))}</ul>
          </Card>
        </>
      ) : (
        groupByDay(shown).map((day) => (
          <Card key={day.date || 'undated'}>
            <DayHeader date={day.date} net={dayTotal(day.rows)} currency={ws.baseCurrency} />
            <ul className="divide-y divide-slate-100">{day.rows.map((row) => rowView(row))}</ul>
          </Card>
        ))
      )}
      <BillList />
    </div>
  );
}
