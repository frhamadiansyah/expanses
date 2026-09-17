import { categoryPath, formatMinor, isoDate, monthOf, parseLooseAmount, parseLooseDate, parseUnits, parsePeriod, periodLabel } from '@expanses/core';
import { confirmDraft, convertToPurchase, createDraft, dismissDraft, editDraft, guessCategoryFromHistory, listTransactions, postTransaction, replaceTransaction, type TransactionView, voidTransaction } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { ArrowUpDown, CalendarDays, CalendarX2, Check, ChevronDown, ChevronLeft, CircleAlert, CreditCard, Ellipsis, Trash2, LayoutGrid, List, Pencil, Plus, Search, Table2, X } from 'lucide-react';
import type { TransactionsSearch } from '../../app/router';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { isCategoryOf, isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCards } from '../cards/card-queries';
import { formatPoints } from '../cards/useCardPoints';
import { useDrafts } from '../review/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, RoundButton, Select } from '../../ui';
import { ChipMenu, type ChipOption } from './ChipMenu';
import { isEditable } from './draft';
import { buildRowOptions, QuickRowEditor } from './QuickRowEditor';
import { isQuickEditable, quickFromDraft, quickFromTransaction, type QuickRead, quickToInput, type QuickValues, readQuick, shortDate } from './quick-row';
import { type TableHandlers, TransactionsTable } from './TransactionsTable';
import { buildRows, dayTotal, EMPTY_FILTERS, filterRows, groupByCategory, groupByDay, type ListFilters, type ListRow, type Sort, sortRows, totals } from './list-model';
import { useAssetValues, useTrades } from '../networth/queries';
import { useGoals } from '../goals/queries';
import { Recurring } from './Recurring';
import { Sheet } from '../../app/Sheet';
import { SpendingReport } from './SpendingReport';
import { TransactionForm } from './TransactionForm';

const route = getRouteApi('/transactions');

type View = 'list' | 'table';
const VIEW_KEY = 'expanses.transactions.view';
const GROUP_KEY = 'expanses.transactions.group';

/** Which view was used last, on this browser. A convenience only: losing it just opens the list. */
function rememberedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'list';
  } catch {
    return 'list';
  }
}

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
  // Any period chosen from the chart's picker stays on the list, under its own name.
  return [{ value: 'all', label: 'All time' }, ...months.map((month) => ({ value: month, label: periodLabel(month) }))];
}

/** One active filter, said in words, with ✕ to take it off. */
function FilterChip({ label, clearLabel, onClear }: { label: ReactNode; clearLabel?: string; onClear: () => void }) {
  return (
    <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-900 py-1 pr-1 pl-3 text-sm text-white">
      {label}
      <button type="button" aria-label={clearLabel ?? `Clear ${typeof label === 'string' ? label.toLowerCase() : 'filter'}`} onClick={onClear} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}

function DayHeader({ date, net, currency }: { date: string; net: number; currency: string }) {
  if (!date) {
    return (
      <div className="-mx-2 flex items-center gap-3 border-b border-slate-200 px-2 pb-2">
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
    <div className="-mx-2 flex items-center gap-3 border-b border-slate-200 px-2 pb-2">
      <span className="tabular w-9 shrink-0 text-2xl leading-none font-semibold">{d.getDate()}</span>
      <span className="flex flex-col text-xs leading-tight text-slate-500">
        <b className="font-semibold text-slate-700">{d.toLocaleDateString('en-GB', { weekday: 'long' })}</b>
        {d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
      </span>
      {/* From md a row ends with room for its edit pencil, so the day's total leaves the same room. */}
      {/* No sign and no red: the day's total sums the rows below it rather than adding anything to them. */}
      {net !== 0 && (
        <span className={cx('tabular ml-auto text-sm font-semibold md:pr-7', net > 0 ? 'text-emerald-700' : 'text-slate-600')}>
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
  // On a phone the search field and the filters are behind their buttons; a wide screen shows both.
  const [showSearch, setShowSearch] = useState(false);
  const phone = usePhone();
  const [showFilters, setShowFilters] = useState(false);
  // By day, as a diary, or by category, as a bill of what the month went on.
  const [grouping, setGrouping] = useState<'date' | 'category'>(() => {
    try {
      return localStorage.getItem(GROUP_KEY) === 'category' ? 'category' : 'date';
    } catch {
      return 'date';
    }
  });
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  // Money out or money in: the chart shows one at a time, and the categories under it follow.
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  function chooseGrouping(next: 'date' | 'category') {
    setGrouping(next);
    try {
      localStorage.setItem(GROUP_KEY, next);
    } catch {
      // Private windows can refuse storage; the grouping still holds for this visit.
    }
  }
  // A view asked for in the URL wins, so /spending and a shared link both open where they meant to.
  const [view, setView] = useState<View>(() => search.view ?? rememberedView());
  const chooseView = (next: View) => {
    setView(next);
    void navigate({ search: (was: TransactionsSearch) => ({ ...was, view: next }), replace: true });
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private windows can refuse storage; the view still switches for this visit.
    }
  };
  /** The full form, for a transaction too involved to edit as a row. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** A row being edited in place. */
  const [editing, setEditing] = useState<{ kind: 'tx' | 'draft'; id: string; values: QuickValues } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const resolveRates = useResolveRates();
  const today = isoDate();
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

  const period = parsePeriod(month);
  const range = period?.from ? { from: period.from, to: period.to! } : {};
  // A day on its own only names a date when a single month is showing.
  const singleMonth = period?.kind === 'month';
  const [paying, setPaying] = useState(false);
  const scope = search.account ? accounts.find((a) => a.id === search.account) : undefined;
  const inCategory = scope !== undefined && (scope.kind === 'expense' || scope.kind === 'income');
  /** A category and everything under it: opening Property must show the rent booked to its child. */
  const scopeIds = (() => {
    if (!scope) return undefined;
    const ids = [scope.id];
    for (let i = 0; i < ids.length; i += 1) {
      for (const account of accounts) if (account.parentId === ids[i] && !ids.includes(account.id)) ids.push(account.id);
    }
    return ids;
  })();
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, scopeIds?.join(',') ?? 'all', month, filters.showDeleted],
    queryFn: () => listTransactions(database, ws, { accountIds: scopeIds, ...range, includeVoid: filters.showDeleted, limit: month === 'all' ? ALL_TIME_LIMIT : undefined }),
  });
  const purchasePoints = useQuery({
    queryKey: ['purchase-points', ws.workspaceId, (list.data ?? []).map((tx) => tx.id).join(',')],
    enabled: list.isSuccess && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, list.data ?? [], accounts),
  });

  // A page opened for one account or category shows only the drafts that touch it.
  const pending = (drafts.data ?? []).filter(
    (draft) => !scopeIds || (draft.accountId !== null && scopeIds.includes(draft.accountId)) || (draft.categoryAccountId !== null && scopeIds.includes(draft.categoryAccountId)),
  );
  const rows = buildRows(list.data ?? [], pending, accounts, cards);
  const shown = sortRows(filterRows(rows, { ...filters, month }, accounts), sort);
  const sum = totals(shown);

  const rowOptions = buildRowOptions(accounts, cards);
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
  // A category opens as its own screen: its ring, its transactions, and a way back to the month.

  // The chart carries the month's total and its count, so the line that used to say them is left off.
  const chartShown = view === 'list' && !filters.onlyDrafts;
  const sortValue = `${sort.key}:${sort.dir}`;
  const narrowed = filters.q || filters.paid || filters.cat || filters.type !== 'all' || filters.showDeleted || filters.onlyDrafts || sortValue !== 'date:desc' || search.month || search.account;

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSort({ key: 'date', dir: 'desc' });
    setSearch({ month: undefined, account: undefined });
  }

  async function run(id: string, work: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusy(id);
    try {
      await work();
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function open(row: ListRow) {
    if (busy) return;
    setAdding(false);
    setArmed(null);
    setError(null);
    setConverting(null);
    if (row.kind === 'draft') {
      setEditingId(null);
      setEditing({ kind: 'draft', id: row.id, values: quickFromDraft(row.draft!, today) });
      return;
    }
    const tx = row.tx!;
    if (tradeByTransaction.has(tx.id) || !isEditable(tx)) return;
    if (isQuickEditable(tx)) {
      setEditingId(null);
      setEditing({ kind: 'tx', id: tx.id, values: quickFromTransaction(tx, today) });
    } else {
      setEditing(null);
      setEditingId(tx.id);
    }
  }

  function close() {
    setEditing(null);
    setEditingId(null);
    setArmed(null);
  }

  async function saveRecorded(id: string, values: QuickValues): Promise<boolean> {
    const { read } = readQuick(values, accounts, today, ws.baseCurrency);
    if (!read) return false;
    return run(id, async () => {
      await replaceTransaction(database, ws, id, { ...quickToInput(read, accounts), ratesToBase: await ratesFor(read) });
      close();
    });
  }

  async function ratesFor(read: QuickRead) {
    const rates = await resolveRates(read.currency === ws.baseCurrency ? [] : [read.currency], read.occurredOn);
    if (rates.missing.length > 0) throw new Error(`No ${rates.missing[0]}→${ws.baseCurrency} rate for ${read.occurredOn}. Use Add transaction to enter one.`);
    return rates.rates;
  }

  /** A row's cells as a draft: whatever could be read, the rest left for the owner to finish. */
  function draftFields(values: QuickValues) {
    const currency = accounts.find((a) => a.id === values.accountId)?.currency ?? ws.baseCurrency;
    return {
      occurredOn: parseLooseDate(values.date, today) ?? values.date.trim(),
      description: values.description.trim(),
      amountMinor: parseLooseAmount(values.amount, currency) ?? 0,
      currency,
      accountId: values.accountId || null,
      cardId: values.cardId || null,
      categoryAccountId: values.categoryId || null,
    };
  }

  async function recordTyped(values: QuickValues) {
    const { read } = readQuick(values, accounts, today, ws.baseCurrency);
    if (!read) return false;
    return run('typing', async () => postTransaction(database, ws, { ...quickToInput(read, accounts), ratesToBase: await ratesFor(read) }));
  }

  const keepTyped = (values: QuickValues) => run('typing', () => createDraft(database, ws, { source: 'manual', ...draftFields(values) }));
  const keepPasted = (pasted: QuickValues[]) =>
    run('typing', async () => {
      for (const values of pasted) await createDraft(database, ws, { source: 'manual', ...draftFields(values) });
    });

  async function saveDraft(id: string, values: QuickValues, record: boolean): Promise<boolean> {
    return run(id, async () => {
      await editDraft(database, ws, id, draftFields(values));
      if (record) await confirmDraft(database, ws, id);
      close();
    });
  }

  /** Deleting asks twice, in place: the first press arms the button, the second deletes. */
  function twoTap(id: string, label: string, armedLabel: string, work: () => Promise<unknown>) {
    return (
      <button
        type="button"
        disabled={busy === id}
        onClick={() => {
          if (armed !== id) setArmed(id);
          else void run(id, async () => {
            await work();
            close();
          });
        }}
        className={cx('rounded-lg px-2 py-1 text-xs font-medium', armed === id ? 'bg-red-700 text-white' : 'text-red-700 hover:bg-red-50')}
      >
        {armed === id ? armedLabel : label}
      </button>
    );
  }

  function editHint(children: ReactNode, actions: ReactNode) {
    return (
      <p className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5 text-xs text-slate-500">
        <span>{children}</span>
        <span className="flex flex-wrap items-center gap-1">{actions}</span>
      </p>
    );
  }

  function draftRow(row: ListRow) {
    if (editing?.kind === 'draft' && editing.id === row.id) {
      const { needs } = readQuick(editing.values, accounts, today, ws.baseCurrency);
      const values = editing.values;
      return (
        <li key={row.id} data-testid="not-recorded-row" className="py-2">
          <QuickRowEditor
            values={values}
            onChange={(patch) => setEditing({ ...editing, values: { ...values, ...patch } })}
            needs={needs}
            options={rowOptions}
            currency={accounts.find((a) => a.id === values.accountId)?.currency ?? ws.baseCurrency}
            autoFocus
            onSubmit={() => void saveDraft(row.id, values, needs.length === 0)}
            onCancel={close}
            actions={
              <>
                <Button className="px-2.5 py-1.5" disabled={needs.length > 0 || busy === row.id} title={needs.length ? `Needs ${needs.join(' & ')}` : 'Record this row'} onClick={() => void saveDraft(row.id, values, true)}>
                  Record
                </Button>
                <Button variant="ghost" className="px-2 py-1.5" aria-label="Close without saving" title="Close without saving" onClick={close}>
                  <X size={16} aria-hidden />
                </Button>
              </>
            }
          />
          {editHint(
            <>
              Not recorded yet · fill what is missing, then <b className="text-slate-700">Record</b> · <kbd>Enter</kbd> records when complete · <kbd>Esc</kbd> closes
            </>,
            <>
              <button type="button" disabled={busy === row.id} onClick={() => void saveDraft(row.id, values, false)} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                Save for later
              </button>
              {twoTap(row.id, 'Discard this row', 'Click again to discard', () => dismissDraft(database, ws, row.id))}
            </>,
          )}
        </li>
      );
    }
    // A row that is not recorded yet is the same row, faded: nothing is wrong with it, it is simply
    // not counted in any total. One fade over the whole row, so nothing inside is dimmed twice.
    return (
      <li
        key={row.id}
        data-testid="not-recorded-row"
        tabIndex={0}
        title="Click to finish"
        onClick={() => open(row)}
        onKeyDown={(event) => event.target === event.currentTarget && event.key === 'Enter' && open(row)}
        className="group -mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 opacity-55 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
      >
        <CategoryIcon categoryId={row.categoryId} accounts={accounts} />
        <div className="min-w-0 flex-1">
          {/* The first line is the category, as on every other row; without one it says so. */}
          <div className="truncate text-sm font-medium">{row.categoryName || 'Uncategorised'}</div>
          <div className="truncate text-xs text-slate-500">
            {row.description || 'No description yet'}
            {row.accountLabel && ` · ${row.accountLabel}`}
            {row.last4 && <span className="tabular font-semibold text-slate-600"> ···· {row.last4}</span>}
            {/* The row already shows what it is missing: "Uncategorised", "—" for the amount, no description,
                no date in its own group. Only the account it was paid with has nowhere else to show. */}
            {row.needs.includes('paid with') && ' · needs an account'}
          </div>
        </div>
        <div className={cx('tabular text-sm font-semibold whitespace-nowrap', row.type === 'income' ? 'text-emerald-700' : 'text-red-700')}>
          {row.amountMinor > 0 ? formatMinor(row.amountMinor, row.currency) : '—'}
        </div>
      </li>
    );
  }

  function recordedRow(row: ListRow, withDate: boolean) {
    const tx = row.tx!;
    const purchaseButton = tx.status === 'posted' && row.type === 'expense' && holdings.length > 0 && (
      <button
        type="button"
        onClick={() => {
          close();
          setConverting(tx.id);
        }}
        className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
        This was a purchase
      </button>
    );
    const deleteButton = twoTap(tx.id, 'Delete this transaction', 'Click again to delete', () => voidTransaction(database, ws, tx.id));
    if (editing?.kind === 'tx' && editing.id === tx.id) {
      const { needs } = readQuick(editing.values, accounts, today, ws.baseCurrency);
      const values = editing.values;
      return (
        <li key={tx.id} className="py-2">
          <QuickRowEditor
            values={values}
            onChange={(patch) => setEditing({ ...editing, values: { ...values, ...patch } })}
            needs={needs}
            options={rowOptions}
            currency={accounts.find((a) => a.id === values.accountId)?.currency ?? ws.baseCurrency}
            autoFocus
            onSubmit={() => void saveRecorded(tx.id, values)}
            onCancel={close}
            actions={
              <>
                <Button className="px-2.5 py-1.5" disabled={needs.length > 0 || busy === tx.id} title={needs.length ? `Needs ${needs.join(' & ')}` : 'Save the change'} onClick={() => void saveRecorded(tx.id, values)}>
                  Save
                </Button>
                <Button variant="ghost" className="px-2 py-1.5" aria-label="Cancel editing" title="Cancel" onClick={close}>
                  <X size={16} aria-hidden />
                </Button>
              </>
            }
          />
          {editHint(
            <>
              Editing in place · <kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels · the original stays under Show deleted
            </>,
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setEditingId(tx.id);
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                Open in form
              </button>
              {purchaseButton}
              {deleteButton}
            </>,
          )}
        </li>
      );
    }
    if (editingId === tx.id) {
      return (
        <li key={tx.id} className="py-2">
          <TransactionForm initial={tx} onDone={close} />
          {editHint(<>The original stays under Show deleted</>, <>{purchaseButton}{deleteButton}</>)}
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
            : tx.entries
                .filter((e) => e.accountKind === row.type)
                // The subcategory alone: "Parking & tolls" says Transportation without repeating it.
                .map((e) => accounts.find((a) => a.id === e.accountId)?.name ?? categoryPath(accounts, e.accountId))
                .join(', ');
    const sign = row.type === 'expense' ? -1 : row.type === 'income' ? 1 : 0;
    const goal = goalName(tradeByTransaction.get(tx.id)?.goalId ?? tx.goalId ?? null);
    const points = purchasePoints.data?.[tx.id];
    const trade = tradeByTransaction.has(tx.id);
    const clickable = !trade && isEditable(tx);
    return (
      <li
        key={tx.id}
        tabIndex={clickable ? 0 : undefined}
        title={clickable ? 'Click to edit' : undefined}
        onClick={clickable ? () => open(row) : undefined}
        onKeyDown={clickable ? (event) => event.target === event.currentTarget && event.key === 'Enter' && open(row) : undefined}
        className={cx(
          'group flex items-center gap-3 py-2',
          row.deleted && 'opacity-50 line-through',
          clickable && '-mx-2 cursor-pointer rounded-lg px-2 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900',
        )}
      >
        <span className={cx(row.deleted && 'grayscale')}>
          {/* Under a category the group already shows the icon, so each row's circle carries its day instead. */}
          <CategoryIcon
            categoryId={row.categoryId}
            accounts={accounts}
            transfer={row.type !== 'expense' && row.type !== 'income'}
            label={withDate && grouping === 'category' && singleMonth && row.date ? String(Number(row.date.slice(8, 10))) : undefined}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {/* Outside a single month the day alone is ambiguous, so the circle's day gains its month here. */}
            {withDate && (!singleMonth || grouping !== 'category') && <span className="tabular mr-2 font-normal text-slate-500">{shortDate(row.date, today)}</span>}
            {label}
          </div>
          <div className="truncate text-xs text-slate-500">
            {tx.description ? `${tx.description} · ` : ''}
            {row.accountLabel}
            {row.last4 && <span className="tabular font-semibold text-slate-600"> ···· {row.last4}</span>}
            {goal && ` · for ${goal}`}
          </div>
        </div>
        <div className="text-right">
          {/* The colour says which way the money went, so the sign would only say it twice. */}
          <div className={cx('tabular text-sm font-semibold whitespace-nowrap', sign < 0 && 'text-red-700', sign > 0 && 'text-emerald-700')}>
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
        {trade ? (
          <Link to="/net-worth/trades" className="text-sm font-medium text-slate-600 underline" title="Edit this on Buy & sell so units stay in step">
            Buy &amp; sell
          </Link>
        ) : (
          clickable && <Pencil size={16} className="hidden text-slate-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 md:block" aria-hidden />
        )}
      </li>
    );
  }

  const tableHandlers: TableHandlers = {
    busy,
    recordTyped,
    keepTyped,
    keepPasted,
    guessCategory: (description) => guessCategoryFromHistory(database, ws, description),
    saveRecorded,
    saveDraft,
    dismissDraft: (id) => run(id, () => dismissDraft(database, ws, id)),
    deleteRecorded: (id) => run(id, () => voidTransaction(database, ws, id)),
    renderForm: (tx, onDone) => <TransactionForm initial={tx} onDone={onDone} />,
    tradeIds: new Set(tradeByTransaction.keys()),
  };

  /**
   * List, Table or Summary — three ways to read the same month.
   *
   * It sits in the header on a wide screen and under it on a phone, where the header's room goes to the
   * round buttons instead. Wherever it is, it is the same control.
   */
  const viewSwitcher = (
    <div role="group" aria-label="View" className="inline-flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
      {(
        [
          ['list', 'List', List],
          ['table', 'Table', Table2],
        ] as const
      ).map(([value, text, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          aria-label={text}
          onClick={() => chooseView(value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium sm:px-3',
            view === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          <Icon size={16} aria-hidden />
          <span className="hidden sm:inline">{text}</span>
        </button>
      ))}
    </div>
  );

  const rowView = (row: ListRow, withDate = false) => (row.kind === 'draft' ? draftRow(row) : recordedRow(row, withDate));

  return (
    // Relative, so the ⋯ menu hangs from the header it opens from.
    <div className="relative space-y-4">
      {/* On a phone, searching takes the whole header: the title and its buttons give way to one field and a way out. */}
      {phone && showSearch ? (
        <div className="flex h-12 items-center gap-2.5 rounded-full bg-white px-4 shadow-sm ring-1 ring-slate-200/70">
          <Search size={18} className="shrink-0 text-slate-400" aria-hidden />
          <input
            // biome-ignore lint/a11y/noAutofocus: the field was asked for by tapping search, so it should be ready to type in
            autoFocus
            type="search"
            value={filters.q}
            onChange={(event) => setFilter('q', event.target.value)}
            placeholder="Search transactions…"
            aria-label="Search transactions"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-base focus:outline-none"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setFilter('q', '');
              setShowSearch(false);
            }}
            className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      ) : (
      <PageHeader
        title={inCategory ? scope!.name : 'Cashflow'}
        controls={
          <>
            <RoundButton label="Add a transaction" onClick={() => { close(); setAdding(true); }}>
              <Plus size={22} aria-hidden />
            </RoundButton>
            {/* Searching and filtering are about what is already here, so they share one pill. */}
            <span className="flex items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70">
              <button
                type="button"
                aria-label="Search"
                aria-pressed={showSearch}
                onClick={() => setShowSearch((was) => !was)}
                className={cx('flex h-11 w-11 items-center justify-center rounded-full', showSearch && 'bg-slate-900 text-white')}
              >
                <Search size={19} aria-hidden />
              </button>
              <button
                type="button"
                aria-label="Filters"
                aria-pressed={showFilters || filters.onlyDrafts || Boolean(filters.paid) || filters.showDeleted}
                aria-expanded={showFilters}
                onClick={() => setShowFilters((was) => !was)}
                className={cx(
                  '-ml-1 flex h-11 w-11 items-center justify-center rounded-full',
                  (showFilters || filters.onlyDrafts || filters.paid || filters.showDeleted) && 'bg-slate-900 text-white',
                )}
              >
                <Ellipsis size={19} aria-hidden />
              </button>
            </span>
          </>
        }
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            {viewSwitcher}
            {!adding && (
              <Button
                onClick={() => {
                  close();
                  setAdding(true);
                }}
              >
                Add transaction
              </Button>
            )}
          </div>
        }
      />
      )}
      {phone && showFilters && (
        <>
          {/* Taps outside the menu close it, the way a pull-down menu behaves on iOS. */}
          <button type="button" aria-label="Close filters" className="fixed inset-0 z-20 cursor-default" onClick={() => setShowFilters(false)} />
          <div role="menu" className="absolute top-16 right-4 z-30 w-60 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200" data-testid="filters-menu">
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={filters.onlyDrafts}
              disabled={pending.length === 0 && !filters.onlyDrafts}
              onClick={() => {
                setFilter('onlyDrafts', !filters.onlyDrafts);
                setShowFilters(false);
              }}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm disabled:opacity-40"
            >
              <CircleAlert size={17} aria-hidden className="text-amber-700" />
              <span className="flex-1">Not recorded</span>
              {filters.onlyDrafts ? <Check size={16} aria-hidden /> : pending.length > 0 && <b className="tabular font-semibold text-amber-700">{pending.length}</b>}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setShowFilters(false);
                setPaying(true);
              }}
              className="flex min-h-12 w-full items-center gap-3 border-t border-slate-100 px-4 text-left text-sm"
            >
              <CreditCard size={17} aria-hidden className="text-slate-500" />
              <span className="flex-1">Paid with</span>
              <span className="max-w-24 truncate text-xs text-slate-500">{paidPicked ? paidPicked.label : 'All'} ›</span>
            </button>
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={filters.showDeleted}
              onClick={() => {
                setFilter('showDeleted', !filters.showDeleted);
                setShowFilters(false);
              }}
              className="flex min-h-12 w-full items-center gap-3 border-t border-slate-100 px-4 text-left text-sm"
            >
              <Trash2 size={17} aria-hidden className="text-slate-500" />
              <span className="flex-1">Show deleted</span>
              {filters.showDeleted && <Check size={16} aria-hidden />}
            </button>
          </div>
        </>
      )}
      {paying && (
        <Sheet title="Paid with" onClose={() => setPaying(false)}>
          <div className="divide-y divide-slate-100" data-testid="paid-with-sheet">
            {paidOptions.map((option) => (
              <button
                key={option.value || 'any'}
                type="button"
                aria-pressed={filters.paid === option.value}
                onClick={() => {
                  setFilter('paid', option.value);
                  setPaying(false);
                }}
                className={cx('flex min-h-12 w-full items-center gap-2 text-left text-sm', option.indent && 'pl-5')}
              >
                <span className="min-w-0 flex-1 truncate">{option.value ? option.label : 'Everything'}</span>
                {option.meta && <span className="tabular text-xs text-slate-500">{option.meta}</span>}
                {filters.paid === option.value && <Check size={16} aria-hidden className="text-emerald-700" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {inCategory && (
        <button type="button" onClick={() => setSearch({ account: undefined })} className="-mt-2 mb-1 flex min-h-11 items-center gap-1 text-sm font-medium text-emerald-800">
          <ChevronLeft size={16} aria-hidden />
          All transactions
        </button>
      )}
      {adding && <TransactionForm onDone={() => setAdding(false)} />}

      <div className="space-y-1">
        {/* On a phone the filters are the ⋯ menu below; the row of chips is a wide screen's. */}
        <div className={cx('flex flex-wrap items-center gap-2', (phone || !showFilters) && 'hidden md:flex')}>
          {!phone && (
          <label className="relative min-w-52 flex-[1_1_280px]">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={filters.q}
              onChange={(event) => setFilter('q', event.target.value)}
              placeholder="Search description, category, card digits or amount"
              aria-label="Search transactions"
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pr-2.5 pl-8 text-base md:text-sm focus:border-slate-900 focus:outline-none"
            />
          </label>
          )}
          {/* The filters sit behind the ⋯ button on a phone, and are simply there on a wide screen. */}
          <div className={cx('flex flex-wrap items-center gap-2', !showFilters && 'hidden md:flex')}>
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
                  Month <b className="font-semibold text-slate-900">{periodLabel(month)}</b>
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
        </div>
{!chartShown && (
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
        )}
      </div>

      {/* The chart leads the list, over whatever period is chosen. */}
      {chartShown && (
        <SpendingReport
          month={month}
          kind={kind}
          onKind={setKind}
          categoryId={scope?.kind === 'expense' || scope?.kind === 'income' ? scope.id : undefined}
          onPick={(id) => setSearch({ account: id })}
          onMonth={(next) => setSearch({ month: next === monthOf(today) ? undefined : next })}
        />
      )}
      <ErrorBox error={error ?? list.error ?? drafts.error} />
      {view === 'table' ? (
        <>
        {!inCategory && chartShown && <Recurring today={today} />}
        <TransactionsTable
          rows={shown}
          options={rowOptions}
          accounts={accounts}
          today={today}
          baseCurrency={ws.baseCurrency}
          handlers={tableHandlers}
          empty={rows.length === 0 ? 'No transactions in this period yet. Type the first one above.' : 'Nothing matches the search and filters.'}
        />
        </>
      ) : (
        <>
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

          {/* What ⋯ has narrowed the list to, each with its own way out. */}
          {phone && (filters.onlyDrafts || filters.paid || filters.showDeleted) && (
            <div className="flex flex-wrap gap-2" data-testid="active-filters">
              {filters.onlyDrafts && (
                <FilterChip label="Not recorded" onClear={() => setFilter('onlyDrafts', false)} />
              )}
              {paidPicked && (
                <FilterChip label={<>Paid with <b className="font-semibold">{paidPicked.label}</b></>} clearLabel="Clear paid with" onClear={() => setFilter('paid', '')} />
              )}
              {filters.showDeleted && <FilterChip label="Showing deleted" onClear={() => setFilter('showDeleted', false)} />}
            </div>
          )}
          {shown.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              {/* Names the list under the chart, and fills the row the two controls would otherwise leave empty. */}
              <h2 className="mr-auto text-base font-semibold">Transaction history</h2>
              <div role="group" aria-label="Group by">
              <div className="inline-flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
                {(
                  [
                    // "Categories", not "By category": the form on this page has a field called Category.
                    ['date', 'Days', CalendarDays],
                    ['category', 'Categories', LayoutGrid],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    aria-pressed={grouping === value}
                    onClick={() => chooseGrouping(value)}
                    className={cx(
                      'flex h-7 w-8 items-center justify-center rounded-md',
                      grouping === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
                    )}
                  >
                    <Icon size={15} aria-hidden />
                  </button>
                ))}
                </div>
              </div>
              {/* Sorting says itself with an arrow rather than a word, so the two controls read as a pair. */}
              <ChipMenu
                name="Sort"
                value={sortValue}
                active={sortValue !== 'date:desc'}
                options={SORTS}
                onPick={(value) => {
                  const [key, dir] = value.split(':') as [Sort['key'], Sort['dir']];
                  setSort({ key, dir });
                }}
                shown={<ArrowUpDown size={15} aria-hidden />}
                iconOnly
              />
            </div>
          )}
          {/* The month's recurring bills sit with the list they are part of, under its controls. */}
          {!inCategory && chartShown && <Recurring today={today} />}

          {sort.key === 'amount' && grouping === 'date' && shown.length > 0 ? (
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
            grouping === 'category' ? (
              (() => {
                // Gathering by category answers "what did the money go on", so it answers it for one
                // direction at a time: the chart's own choice of money out or money in.
                const groups = groupByCategory(shown.filter((row) => row.type === kind));
                const whole = groups.reduce((sum, group) => sum + Math.abs(group.totalMinor), 0);
                return groups.map((group) => {
                  const key = group.id ?? group.name;
                  const open = openCategory === key;
                  return (
                    <Card key={key}>
                      <button
                        type="button"
                        onClick={() => setOpenCategory(open ? null : key)}
                        aria-expanded={open}
                        className="flex w-full items-center gap-3 text-left"
                        data-testid="category-group"
                      >
                        <CategoryIcon categoryId={group.id} accounts={accounts} transfer={group.id === null} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{group.name}</span>
                          <span className="block text-xs text-slate-500">
                            {group.rows.length} transaction{group.rows.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="text-right">
                          <Money minor={Math.abs(group.totalMinor)} currency={ws.baseCurrency} className="block text-sm font-semibold" />
                          {whole > 0 && group.totalMinor !== 0 && (
                            <span className="block text-xs text-slate-500">{Math.round((Math.abs(group.totalMinor) / whole) * 100)}%</span>
                          )}
                        </span>
                        <ChevronDown size={16} aria-hidden className={cx('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
                      </button>
                      {open && <ul className="mt-1 divide-y divide-slate-100 border-t border-slate-100">{group.rows.map((row) => rowView(row, true))}</ul>}
                    </Card>
                  );
                });
              })()
            ) : (
              groupByDay(shown).map((day) => (
                <Card key={day.date || 'undated'}>
                  <DayHeader date={day.date} net={dayTotal(day.rows)} currency={ws.baseCurrency} />
                  <ul className="divide-y divide-slate-100">{day.rows.map((row) => rowView(row))}</ul>
                </Card>
              ))
            )
          )}
        </>
      )}
    </div>
  );
}
