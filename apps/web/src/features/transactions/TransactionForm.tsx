import {
  exchangeLines,
  expenseLines,
  incomeLines,
  isoDate,
  minorToMajorString,
  parseMajor,
  type PostingLine,
  splitExpenseLines,
  transferLines,
} from '@expanses/core';
import { type AccountRow, postTransaction, replaceTransaction, type TransactionView, upsertRate } from '@expanses/db';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { isCategoryOf, isMoneyAccount, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Select } from '../../ui';
import { classify } from './classify';

type Mode = 'expense' | 'income' | 'transfer';
interface SplitRow {
  categoryId: string;
  amount: string;
}

function MoneyAccountOptions({ accounts }: { accounts: AccountRow[] }) {
  const money = accounts.filter(isMoneyAccount);
  return (
    <>
      <option value="">Choose…</option>
      <optgroup label="Accounts">
        {money.filter((a) => a.kind === 'asset').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
      <optgroup label="Credit cards & debts">
        {money.filter((a) => a.kind === 'liability').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
    </>
  );
}

function CategoryOptions({ accounts, kind }: { accounts: AccountRow[]; kind: 'expense' | 'income' }) {
  const categories = accounts.filter(isCategoryOf(kind));
  const roots = categories.filter((c) => c.parentId === null);
  return (
    <>
      <option value="">Choose…</option>
      {roots.map((root) => {
        const children = categories.filter((c) => c.parentId === root.id);
        if (children.length === 0) return <option key={root.id} value={root.id}>{root.name}</option>;
        return (
          <optgroup key={root.id} label={root.name}>
            <option value={root.id}>{`${root.name} (general)`}</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

function initialState(initial: TransactionView | undefined) {
  const base = { mode: 'expense' as Mode, occurredOn: isoDate(), description: '', moneyId: '', toId: '', categoryId: '', amount: '', toAmount: '', splits: [] as SplitRow[] };
  if (!initial) return base;
  const c = classify(initial);
  const money = initial.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const common = { ...base, occurredOn: initial.occurredOn, description: initial.description };
  if (c.type === 'expense') {
    const expenses = initial.entries.filter((e) => e.accountKind === 'expense');
    const payment = money[0]!;
    return {
      ...common,
      mode: 'expense' as Mode,
      moneyId: payment.accountId,
      categoryId: expenses.length === 1 ? expenses[0]!.accountId : '',
      amount: expenses.length === 1 ? minorToMajorString(expenses[0]!.amountMinor, payment.currency) : '',
      splits: expenses.length > 1 ? expenses.map((e) => ({ categoryId: e.accountId, amount: minorToMajorString(e.amountMinor, e.currency) })) : [],
    };
  }
  if (c.type === 'income') {
    const income = initial.entries.find((e) => e.accountKind === 'income')!;
    return { ...common, mode: 'income' as Mode, moneyId: money[0]?.accountId ?? '', categoryId: income.accountId, amount: minorToMajorString(-income.amountMinor, income.currency) };
  }
  const from = money.find((e) => e.amountMinor < 0);
  const to = money.find((e) => e.amountMinor > 0);
  return {
    ...common,
    mode: 'transfer' as Mode,
    moneyId: from?.accountId ?? '',
    toId: to?.accountId ?? '',
    amount: from ? minorToMajorString(-from.amountMinor, from.currency) : '',
    toAmount: to && from && to.currency !== from.currency ? minorToMajorString(to.amountMinor, to.currency) : '',
  };
}

export function TransactionForm({ initial, onDone }: { initial?: TransactionView; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const [state, setState] = useState(() => initialState(initial));
  const [manualRate, setManualRate] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, ...patch }));

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const moneyAccount = byId.get(state.moneyId);
  const toAccount = byId.get(state.toId);
  const currency = moneyAccount?.currency ?? ws.baseCurrency;
  const crossCurrency = state.mode === 'transfer' && moneyAccount && toAccount && moneyAccount.currency !== toAccount.currency;
  const splitTotal = state.splits.reduce((s, r) => {
    try {
      return s + (r.amount.trim() ? parseMajor(r.amount, currency) : 0);
    } catch {
      return s;
    }
  }, 0);

  function buildLines(): PostingLine[] {
    if (!moneyAccount) throw new Error(state.mode === 'transfer' ? 'Choose the From account' : 'Choose an account');
    const amountMinor = parseMajor(state.amount, currency);
    if (amountMinor <= 0 && state.splits.length === 0) throw new Error('Amount must be greater than zero');
    if (state.mode === 'expense') {
      if (state.splits.length > 0) {
        const splits = state.splits.map((r) => {
          if (!r.categoryId) throw new Error('Choose a category for every split');
          return { categoryAccountId: r.categoryId, amountMinor: parseMajor(r.amount, currency) };
        });
        return splitExpenseLines({ paymentAccountId: moneyAccount.id, currency, splits });
      }
      if (!state.categoryId) throw new Error('Choose a category');
      return expenseLines({ categoryAccountId: state.categoryId, paymentAccountId: moneyAccount.id, amountMinor, currency });
    }
    if (state.mode === 'income') {
      if (!state.categoryId) throw new Error('Choose a category');
      return incomeLines({ incomeAccountId: state.categoryId, depositAccountId: moneyAccount.id, amountMinor, currency });
    }
    if (!toAccount) throw new Error('Choose the To account');
    if (toAccount.id === moneyAccount.id) throw new Error('From and To must differ');
    if (!crossCurrency) return transferLines({ fromAccountId: moneyAccount.id, toAccountId: toAccount.id, amountMinor, currency });
    const exchange = accounts.find((a) => a.systemKey === 'currency_exchange');
    if (!exchange) throw new Error('Currency exchange account missing');
    return exchangeLines({
      fromAccountId: moneyAccount.id,
      fromAmountMinor: amountMinor,
      fromCurrency: moneyAccount.currency!,
      toAccountId: toAccount.id,
      toAmountMinor: parseMajor(state.toAmount, toAccount.currency!),
      toCurrency: toAccount.currency!,
      exchangeAccountId: exchange.id,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const lines = buildLines();
      const foreign = [...new Set(lines.map((l) => l.currency))].filter((c) => c !== ws.baseCurrency);
      if (needsRate && manualRate.trim()) {
        await upsertRate(database, { fromCurrency: needsRate, toCurrency: ws.baseCurrency, onDate: state.occurredOn, rate: Number(manualRate), source: 'manual', sourceDate: state.occurredOn });
      }
      const resolved = await resolveRates(foreign, state.occurredOn);
      if (resolved.missing.length > 0) {
        setNeedsRate(resolved.missing[0]!);
        throw new Error(`No ${resolved.missing[0]}→${ws.baseCurrency} rate for ${state.occurredOn}. Enter it below.`);
      }
      const input = { occurredOn: state.occurredOn, description: state.description || (state.mode === 'transfer' ? 'Transfer' : ''), lines, ratesToBase: resolved.rates };
      if (initial) await replaceTransaction(database, ws, initial.id, input);
      else await postTransaction(database, ws, input);
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          {(['expense', 'income', 'transfer'] as const).map((m) => (
            <Button key={m} variant={state.mode === m ? 'primary' : 'secondary'} aria-pressed={state.mode === m} onClick={() => set({ mode: m, categoryId: '', splits: [] })}>
              {m === 'expense' ? 'Expense' : m === 'income' ? 'Income' : 'Transfer'}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={state.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} required />
          </Field>
          <Field label="Description">
            <Input value={state.description} onChange={(e) => set({ description: e.target.value })} placeholder={state.mode === 'transfer' ? 'Transfer' : 'Superindo'} />
          </Field>
          <Field label={state.mode === 'expense' ? 'Paid with' : state.mode === 'income' ? 'Received into' : 'From'}>
            <Select value={state.moneyId} onChange={(e) => set({ moneyId: e.target.value })}>
              <MoneyAccountOptions accounts={accounts} />
            </Select>
          </Field>
          {state.mode === 'transfer' ? (
            <Field label="To" hint="Paying a credit card bill? Choose the card here.">
              <Select value={state.toId} onChange={(e) => set({ toId: e.target.value })}>
                <MoneyAccountOptions accounts={accounts} />
              </Select>
            </Field>
          ) : (
            state.splits.length === 0 && (
              <Field label="Category">
                <Select value={state.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <CategoryOptions accounts={accounts} kind={state.mode} />
                </Select>
              </Field>
            )
          )}
          {state.splits.length === 0 && (
            <Field label={`Amount (${currency})`}>
              <Input aria-label="Amount" value={state.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" required />
            </Field>
          )}
          {crossCurrency && (
            <Field label={`Received amount (${toAccount!.currency})`}>
              <Input value={state.toAmount} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
            </Field>
          )}
        </div>

        {state.mode === 'expense' && (
          <div className="space-y-2">
            {state.splits.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                <Select aria-label={`Split ${i + 1} category`} value={row.categoryId} onChange={(e) => set({ splits: state.splits.map((r, j) => (j === i ? { ...r, categoryId: e.target.value } : r)) })}>
                  <CategoryOptions accounts={accounts} kind="expense" />
                </Select>
                <Input aria-label={`Split ${i + 1} amount`} value={row.amount} inputMode="decimal" onChange={(e) => set({ splits: state.splits.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })} />
                <Button variant="ghost" onClick={() => set({ splits: state.splits.filter((_, j) => j !== i) })} aria-label={`Remove split ${i + 1}`}>
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() =>
                  set({
                    splits: state.splits.length
                      ? [...state.splits, { categoryId: '', amount: '' }]
                      : [{ categoryId: state.categoryId, amount: state.amount }, { categoryId: '', amount: '' }],
                  })
                }
              >
                Split
              </Button>
              {state.splits.length > 0 && <span className="tabular text-sm text-slate-600">Total {minorToMajorString(splitTotal, currency)} {currency}</span>}
            </div>
          </div>
        )}

        {needsRate && (
          <Field label={`Rate: ${ws.baseCurrency} per 1 ${needsRate}`}>
            <Input value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" />
          </Field>
        )}
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
