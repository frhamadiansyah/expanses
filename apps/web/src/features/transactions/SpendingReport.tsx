import { addMonths, categoryTree, type CategoryTreeNode, formatMinor, monthRange } from '@expanses/core';
import { categoryTotalsBetween } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Button, Card, cx, Empty, Money } from '../../ui';
import { useCategorySetMembership, useCategorySets } from '../categories/set-queries';
import { categoryColour, OTHER_COLOUR, ringSlices, shade } from './category-colours';
import { Donut, type DonutSlice } from './Donut';
import { IncomeFlow } from './IncomeFlow';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** The node for a category anywhere in the tree, so a page showing one can draw it. */
function findNode(nodes: readonly CategoryTreeNode[], id: string): CategoryTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const inside = findNode(node.children, id);
    if (inside) return inside;
  }
  return undefined;
}

/** A row under the ring: the colour it was drawn in, what it was, and what it came to. */
function Row({
  node,
  colour,
  widest,
  totalMinor,
  month,
  onOpen,
}: {
  node: CategoryTreeNode;
  colour: string;
  widest: number;
  totalMinor: number;
  month: string;
  onOpen?: () => void;
}) {
  const { ws } = useApp();
  const inside = (
    <>
      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour }} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{node.name}</span>
        <span className="text-xs text-slate-500">{share(node.totalMinor, totalMinor)}% of the month</span>
        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-slate-100">
          <span className="block h-1 rounded-full" style={{ width: `${widest > 0 ? (node.totalMinor / widest) * 100 : 0}%`, background: colour }} />
        </span>
      </span>
      <Money minor={node.totalMinor} currency={ws.baseCurrency} className="shrink-0 text-sm font-semibold" />
    </>
  );
  // A category with children opens into them; one without goes straight to its transactions.
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex w-full min-h-12 items-start gap-3 py-2.5 text-left" data-testid="report-row">
      {inside}
      <ChevronRight size={16} aria-hidden className="mt-2 shrink-0 text-slate-300" />
    </button>
  ) : (
    <Link to="/transactions" search={{ account: node.id, month }} className="flex min-h-12 items-start gap-3 py-2.5" data-testid="report-row">
      {inside}
      <ChevronRight size={16} aria-hidden className="mt-2 shrink-0 text-slate-300" />
    </Link>
  );
}

/** The ring, its legend and its rows — used for the month as a whole and for one category inside it. */
function Ring({
  nodes,
  totalMinor,
  middleLabel,
  month,
  colourOf,
  transactions,
  showRows,
  onOpen,
  onAsk,
  onFold,
}: {
  nodes: readonly CategoryTreeNode[];
  totalMinor: number;
  middleLabel: string;
  month: string;
  /** How a child ring tints its slices. The month's own ring takes the palette, clashes resolved. */
  colourOf?: (node: CategoryTreeNode, index: number) => string;
  transactions: number;
  /** Rows under the ring. The month folds them away until asked; a category always shows its own. */
  showRows?: boolean;
  onOpen?: (node: CategoryTreeNode) => void;
  /** Unfolds the rows. Given together with onFold, the pair is how the list opens and closes. */
  onAsk?: () => void;
  onFold?: () => void;
}) {
  const { ws } = useApp();
  const ordered = [...nodes].sort((a, b) => b.totalMinor - a.totalMinor);
  const { shown, rest } = ringSlices(ordered.map((node) => ({ id: node.id, totalMinor: node.totalMinor })));
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const slices: DonutSlice[] = shown.map((slice, index) => ({
    key: slice.item.id,
    label: byId.get(slice.item.id)?.name ?? '',
    totalMinor: slice.totalMinor,
    colour: colourOf ? colourOf(byId.get(slice.item.id)!, index) : slice.colour,
  }));
  const colourById = new Map(slices.map((slice) => [slice.key, slice.colour]));
  const restMinor = rest.reduce((sum, item) => sum + item.totalMinor, 0);
  if (restMinor > 0) slices.push({ key: 'other', label: `${rest.length} smaller categories`, totalMinor: restMinor, colour: OTHER_COLOUR });
  const widest = ordered[0]?.totalMinor ?? 0;

  return (
    <Card>
      <Donut
        slices={slices}
        totalMinor={totalMinor}
        middle={formatMinor(totalMinor, ws.baseCurrency)}
        label={middleLabel}
        under={transactions > 0 ? `${transactions} transaction${transactions === 1 ? '' : 's'}` : undefined}
        onPick={onOpen ? (key) => { const node = byId.get(key); if (node) onOpen(node); } : undefined}
      />
      {!showRows && (
        <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-xs text-slate-600">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: slice.colour }} aria-hidden />
              {slice.label} {share(slice.totalMinor, totalMinor)}%
            </li>
          ))}
        </ul>
      )}
      {showRows ? (
        <>
        <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
          {ordered.map((node, index) => (
            <Row
              key={node.id}
              node={node}
              colour={colourById.get(node.id) ?? (colourOf ? colourOf(node, index) : categoryColour(node.id))}
              widest={widest}
              totalMinor={totalMinor}
              month={month}
              onOpen={onOpen && node.children.length > 0 ? () => onOpen(node) : undefined}
            />
          ))}
        </div>
        {onFold && (
          <button type="button" onClick={onFold} className="mt-1 min-h-11 w-full text-sm font-medium text-slate-500" data-testid="hide-categories">
            Hide categories
          </button>
        )}
        </>
      ) : (
        onAsk && (
          <button type="button" onClick={onAsk} className="mt-1 min-h-11 w-full text-sm font-medium text-emerald-800" data-testid="see-categories">
            See all categories ›
          </button>
        )
      )}
    </Card>
  );
}

/**
 * Where a month's money went, by category: the same transactions the list shows, added up.
 *
 * It reads the month the page is already on, so switching between the list and this is a change of
 * view rather than a change of subject. A category with children opens into its own ring; one without
 * leads to the transactions behind it.
 */
export function SpendingReport({
  month,
  categoryId,
  onPick,
  onMonth,
}: {
  month: string;
  categoryId?: string;
  onPick?: (id: string) => void;
  /** Given, the chart carries the month itself: the arrows step through them. */
  onMonth?: (month: string) => void;
}) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  // The categories are folded away until asked for: the list underneath is what most days are about.
  const [showAll, setShowAll] = useState(false);
  const { from, to } = monthRange(month);

  const totals = useQuery({
    queryKey: ['category-totals', ws.workspaceId, kind, month],
    queryFn: () => categoryTotalsBetween(database, ws, kind, from, to),
  });
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets().data ?? [];
  const ofKind = accounts.filter((a) => a.kind === kind);
  const amounts = (totals.data ?? []).map((row) => ({ accountId: row.accountId, amountBaseMinor: row.amountBaseMinor }));
  const countById = new Map((totals.data ?? []).map((row) => [row.accountId, row.transactions]));
  const tree = categoryTree(
    ofKind.filter((a) => membership[a.id] === undefined),
    amounts,
  );
  // Each set is shown as its own group rather than mixed in: a renovation is read as a renovation.
  const setGroups = sets
    .map((set) => ({ set, tree: categoryTree(ofKind.filter((a) => membership[a.id] === set.id), amounts) }))
    .filter((group) => group.tree.length > 0);
  const total = [tree, ...setGroups.map((group) => group.tree)].flat().reduce((s, n) => s + n.totalMinor, 0);
  /** How many transactions sit under a category, its children included. */
  const countIn = (node: CategoryTreeNode): number => (countById.get(node.id) ?? 0) + node.children.reduce((sum, child) => sum + countIn(child), 0);
  const transactions = tree.reduce((sum, node) => sum + countIn(node), 0) + setGroups.flatMap((g) => g.tree).reduce((sum, node) => sum + countIn(node), 0);
  /** The category being looked at, when the page is showing one. Its children make the ring. */
  const open = categoryId ? (findNode(tree, categoryId) ?? null) : null;

  return (
    <div className="space-y-4" data-testid="spending-report">
      {/* The chart is about one month, so the month is moved from here rather than from a filter. */}
      {onMonth && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" className="px-2 py-1" aria-label="Earlier month" onClick={() => onMonth(addMonths(month, -1))}>
            <ChevronLeft size={18} aria-hidden />
          </Button>
          <span className="text-sm font-semibold" data-testid="chart-month">
            {monthLabel(month)}
          </span>
          <Button variant="ghost" className="px-2 py-1" aria-label="Later month" onClick={() => onMonth(addMonths(month, 1))}>
            <ChevronRight size={18} aria-hidden />
          </Button>
        </div>
      )}
      <div className={cx('flex flex-wrap items-center gap-2', open && 'hidden')}>
        {(['expense', 'income'] as const).map((k) => (
          <Button
            key={k}
            variant={kind === k ? 'primary' : 'secondary'}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            {/* Not "Spending" and "Income": the form on this same page already has buttons by those names. */}
            {k === 'expense' ? 'Money out' : 'Money in'}
          </Button>
        ))}
      </div>

      {open ? (
        <Ring
          nodes={open.ownMinor > 0 ? [...open.children, { id: open.id, name: `${open.name} (general)`, ownMinor: open.ownMinor, totalMinor: open.ownMinor, children: [] }] : open.children}
          totalMinor={open.totalMinor}
          middleLabel={open.name}
          month={month}
          transactions={countIn(open)}
          showRows
          colourOf={(_, index) => shade(categoryColour(open.id), index, Math.max(2, open.children.length))}
        />
      ) : (
        <>
          <div data-testid="period-total" className="sr-only">
            <Money minor={total} currency={ws.baseCurrency} />
          </div>
          {totals.isSuccess && tree.length === 0 && setGroups.length === 0 ? (
            <Card>
              <Empty>Nothing recorded for {monthLabel(month)}.</Empty>
            </Card>
          ) : (
            <Ring
              nodes={tree}
              totalMinor={total}
              middleLabel={kind === 'expense' ? `Spent in ${monthLabel(month).split(' ')[0]}` : `Earned in ${monthLabel(month).split(' ')[0]}`}
              month={month}
              transactions={transactions}
              showRows={showAll}
              onAsk={() => setShowAll(true)}
              onFold={() => setShowAll(false)}
              onOpen={onPick ? (node) => onPick(node.id) : undefined}
            />
          )}
          {setGroups.map((group) => (
            <Card key={group.set.id}>
              <div data-testid={`set-group-${group.set.name}`}>
                <h2 className="mb-1 text-sm font-semibold">{group.set.name}</h2>
                <div className="divide-y divide-slate-100">
                  {group.tree.map((node) => (
                    <Row key={node.id} node={node} colour={categoryColour(node.id)} widest={group.tree[0]?.totalMinor ?? 0} totalMinor={total} month={month} />
                  ))}
                </div>
              </div>
            </Card>
          ))}
          {/* Where the month's income went, and what it did not cover. It needs width, so the phone leaves it out. */}
          <div className="hidden md:block">
            <IncomeFlow month={month} />
          </div>
        </>
      )}
    </div>
  );
}
