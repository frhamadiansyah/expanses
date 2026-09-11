import { addMonths, categoryTree, type CategoryTreeNode, isoDate, monthOf, monthRange } from '@expanses/core';
import { categoryTotalsBetween } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Button, Card, Empty, Money, PageHeader } from '../../ui';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function Node({ node, max, month, depth }: { node: CategoryTreeNode; max: number; month: string; depth: number }) {
  const { ws } = useApp();
  const [open, setOpen] = useState(false);
  const pct = max > 0 ? Math.max(2, Math.round((node.totalMinor / max) * 100)) : 0;
  return (
    <li>
      <div className="flex items-center gap-3 py-2" style={{ paddingLeft: depth * 20 }}>
        {node.children.length > 0 ? (
          <button type="button" className="w-5 text-slate-500" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Toggle ${node.name}`}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <div className="min-w-0 flex-1">
          <Link to="/transactions" search={{ account: node.id, month }} className="text-sm font-medium hover:underline">
            {node.name}
          </Link>
          <div className="mt-1 h-1.5 rounded bg-slate-100">
            <div className="h-1.5 rounded bg-slate-800" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Money minor={node.totalMinor} currency={ws.baseCurrency} className="text-sm font-medium" />
      </div>
      {open && (
        <ul>
          {node.ownMinor !== 0 && node.children.length > 0 && (
            <li className="flex justify-between py-1 text-sm text-slate-500" style={{ paddingLeft: (depth + 1) * 20 + 32 }}>
              <span>{node.name} (general)</span>
              <Money minor={node.ownMinor} currency={ws.baseCurrency} />
            </li>
          )}
          {node.children.map((child) => (
            <Node key={child.id} node={child} max={max} month={month} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SpendingPage() {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const [month, setMonth] = useState(monthOf(isoDate()));
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const { from, to } = monthRange(month);

  const totals = useQuery({
    queryKey: ['category-totals', ws.workspaceId, kind, month],
    queryFn: () => categoryTotalsBetween(database, ws, kind, from, to),
  });
  const tree = categoryTree(accounts.filter((a) => a.kind === kind), totals.data ?? []);
  const total = tree.reduce((s, n) => s + n.totalMinor, 0);
  const max = tree[0]?.totalMinor ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title={kind === 'expense' ? 'Spending' : 'Income'} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          ‹
        </Button>
        <span className="min-w-40 text-center font-medium">{monthLabel(month)}</span>
        <Button variant="secondary" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </Button>
        <div className="ml-auto flex gap-2">
          {(['expense', 'income'] as const).map((k) => (
            <Button key={k} variant={kind === k ? 'primary' : 'secondary'} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'expense' ? 'Spending' : 'Income'}
            </Button>
          ))}
        </div>
      </div>
      <Card>
        <div className="text-xs text-slate-500">Total in {ws.baseCurrency}</div>
        <div data-testid="period-total" className="text-2xl font-semibold">
          <Money minor={total} currency={ws.baseCurrency} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Card purchases count when made. Paying a card bill is a transfer, not spending.</p>
      </Card>
      <Card>
        {totals.isSuccess && tree.length === 0 ? (
          <Empty>Nothing recorded for {monthLabel(month)}.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tree.map((node) => (
              <Node key={node.id} node={node} max={max} month={month} depth={0} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
