import { addMonths, type BudgetLine, budgetSheet, isoDate, monthOf, parseMajor } from '@expanses/core';
import { clearBudgetOverride, removeBudget, saveBudget, setBudgetOverride } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money, PageHeader, Select } from '../../ui';
import { useBudgets, useCategorySpending } from './queries';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function Line({ node, overridden, depth }: { node: BudgetLine; overridden: Set<string>; depth: number }) {
  const { ws } = useApp();
  return (
    <li data-testid={`line-${node.name}`}>
      <div className="flex items-center gap-3 py-2" style={{ paddingLeft: depth * 20 }}>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{node.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {node.capMinor === null ? (
              'No budget'
            ) : (
              <>
                Cap <Money minor={node.capMinor} currency={ws.baseCurrency} />
                {overridden.has(node.id) && ' · just this month'}
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <Money minor={node.totalMinor} currency={ws.baseCurrency} className="text-sm font-medium" />
          {node.overMinor > 0 && (
            <div className="text-xs font-medium text-rose-600">
              Over by <Money minor={node.overMinor} currency={ws.baseCurrency} />
            </div>
          )}
        </div>
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Line key={child.id} node={child} overridden={overridden} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function BudgetPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [month, setMonth] = useState(monthOf(isoDate()));
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [thisMonthOnly, setThisMonthOnly] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const accounts = useAccounts().data ?? [];
  const categories = accounts.filter((account) => account.kind === 'expense');
  const spending = useCategorySpending(month);
  const budgets = useBudgets(month);

  const sheet = budgetSheet({
    month,
    categories,
    amounts: spending.data ?? [],
    caps: (budgets.data ?? []).map((row) => ({ categoryId: row.categoryAccountId, amountMinor: row.amountMinor })),
    // The income, debt and savings lines arrive with the rest of the sheet in the next slice.
    incomePlanMinor: 0,
    incomeActualMinor: 0,
    debtPaymentsPlanMinor: 0,
    debtPaymentsActualMinor: 0,
    savings: [],
  });
  const overridden = new Set((budgets.data ?? []).filter((row) => row.overridden).map((row) => row.categoryAccountId));

  // Roots first, each followed by its children, so the select reads like the sheet.
  const options = categories
    .filter((account) => !categories.some((parent) => parent.id === account.parentId))
    .flatMap((root) => [
      { id: root.id, label: root.name },
      ...categories.filter((child) => child.parentId === root.id).map((child) => ({ id: child.id, label: `— ${child.name}` })),
    ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const target = categoryId || options[0]?.id;
      if (!target) throw new Error('There are no categories to budget for yet');
      const minor = parseMajor(amount, ws.baseCurrency);
      if (thisMonthOnly) await setBudgetOverride(database, ws, { categoryAccountId: target, month, amountMinor: minor });
      else await saveBudget(database, ws, { categoryAccountId: target, amountMinor: minor });
      await invalidate();
      setAmount('');
    } catch (e) {
      setError(e);
    }
  }

  async function remove() {
    setError(null);
    try {
      const target = categoryId || options[0]?.id;
      if (!target) return;
      if (thisMonthOnly) await clearBudgetOverride(database, ws, target, month);
      else await removeBudget(database, ws, target);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Budget" />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          ‹
        </Button>
        <span className="min-w-40 text-center font-medium">{monthLabel(month)}</span>
        <Button variant="secondary" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </Button>
      </div>

      <ErrorBox error={error} />

      <Card className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-slate-500">Budgeted</div>
            <div data-testid="caps-total" className="text-xl font-semibold">
              <Money minor={sheet.capsTotalMinor} currency={ws.baseCurrency} />
            </div>
            <div className="text-xs text-slate-500">A budget inside a budget is a tighter cap, not more money.</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Spent</div>
            <div data-testid="spent-total" className="text-xl font-semibold">
              <Money minor={sheet.spendingActualMinor} currency={ws.baseCurrency} />
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Over</div>
            <div className="text-xl font-semibold">{sheet.overCount}</div>
            <div className="text-xs text-slate-500">Going over is recorded, never blocked.</div>
          </div>
        </div>
      </Card>

      <Card>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-[2fr_1fr_auto_auto] md:items-end">
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Monthly amount (${ws.baseCurrency})`}>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
            <input type="checkbox" checked={thisMonthOnly} onChange={(e) => setThisMonthOnly(e.target.checked)} />
            Just this month
          </label>
          <div className="flex gap-2 pb-1">
            <Button type="submit">Set budget</Button>
            <Button type="button" variant="secondary" onClick={remove}>
              Remove
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <ul className="divide-y divide-slate-100">
          {sheet.lines.map((node) => (
            <Line key={node.id} node={node} overridden={overridden} depth={0} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
