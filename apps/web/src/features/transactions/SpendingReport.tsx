import { type BudgetLine, categoryTree, type CategoryTreeNode, formatMinor, isoDate, parsePeriod, periodLabel, stepPeriod } from '@expanses/core';
import { budgetSheetFor, categoryTotalsIn, firstTransactionDate } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { Button, Card, cx, Empty, Money } from '../../ui';
import { useCategorySetMembership, useCategorySets } from '../categories/set-queries';
import { budgetProgress } from './budget-progress';
import { BudgetGauge } from './BudgetGauge';
import { categoryColour, OTHER_COLOUR, ringSlices, shade } from './category-colours';
import { CapLine, ShareLine } from './CategoryLines';
import { Deck } from './Deck';
import { Donut, type DonutSlice } from './Donut';
import { PeriodPicker, yearsSince } from './PeriodPicker';
import { IncomeFlow } from './IncomeFlow';
import { mergeUnconverted, Unconverted, type UnconvertedRow } from '../workspaces/Unconverted';


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
  totalMinor,
  month,
  currency,
  capMinor,
  against = 'month',
  onOpen,
}: {
  node: CategoryTreeNode;
  colour: string;
  totalMinor: number;
  month: string;
  /** What the figures read in: the open workspace's own currency. */
  currency: string;
  /** What this category was budgeted this month, if anything. The bar measures the month against it. */
  capMinor?: number | null;
  /** What the row is being read against, which is whichever chart the card is showing. */
  against?: 'month' | 'budget';
  onOpen?: () => void;
}) {
  const inside =
    against === 'budget' ? (
      <CapLine colour={colour} name={node.name} amountMinor={node.totalMinor} capMinor={capMinor} currency={currency} />
    ) : (
      <ShareLine colour={colour} name={node.name} amountMinor={node.totalMinor} wholeMinor={totalMinor} currency={currency} />
    );
  // A category with children opens into them; one without goes straight to its transactions.
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex min-h-12 w-full flex-col py-2.5 text-left" data-testid="report-row">
      {inside}
    </button>
  ) : (
    <Link to="/transactions" search={{ account: node.id, month }} className="flex min-h-12 flex-col py-2.5" data-testid="report-row">
      {inside}
    </Link>
  );
}

/** The ring, its legend and its rows — used for the month as a whole and for one category inside it. */
function Ring({
  nodes,
  totalMinor,
  middleLabel,
  month,
  currency,
  colourOf,
  transactions,
  caps,
  showRows,
  header,
  extra = [],
  second,
  page = 0,
  onPage,
  onOpen,
  onAsk,
  onFold,
}: {
  nodes: readonly CategoryTreeNode[];
  totalMinor: number;
  middleLabel: string;
  month: string;
  /** What the figures read in: the open workspace's own currency. */
  currency: string;
  /** How a child ring tints its slices. The month's own ring takes the palette, clashes resolved. */
  colourOf?: (node: CategoryTreeNode, index: number) => string;
  transactions: number;
  /** What each category was budgeted this month, by category id. */
  caps?: Record<string, number>;
  /** Rows under the ring. The month folds them away until asked; a category always shows its own. */
  showRows?: boolean;
  /** Drawn inside the card above the ring, so the month and the kind travel with the chart. */
  header?: ReactNode;
  /** Slices with no row of their own here — a category set, listed in its own card below — so the ring still adds up. */
  extra?: readonly { key: string; label: string; totalMinor: number }[];
  /** A second chart, shown by swiping the card sideways. Given, the card grows a pair of dots. */
  second?: ReactNode;
  /** Which chart is showing. The rows measure themselves against the same thing it does. */
  page?: number;
  onPage?: (page: number) => void;
  onOpen?: (node: CategoryTreeNode) => void;
  /** Unfolds the rows. Given together with onFold, the pair is how the chart opens and closes the list. */
  onAsk?: () => void;
  onFold?: () => void;
}) {
  // One tap on the chart, whichever way the list is at the time.
  const fold = showRows ? onFold : onAsk;
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
  for (const slice of extra) if (slice.totalMinor > 0) slices.push({ ...slice, colour: categoryColour(slice.key) });

  const donut = (
    <Donut
      slices={slices}
      totalMinor={totalMinor}
      middle={formatMinor(totalMinor, currency)}
      label={middleLabel}
      under={transactions > 0 ? `${transactions} transaction${transactions === 1 ? '' : 's'}` : undefined}
      onPick={fold ? undefined : onOpen ? (key) => { const node = byId.get(key); if (node) onOpen(node); } : undefined}
    />
  );
  // A div rather than a button: the deck inside it scrolls sideways, which a button's content will not do on iOS.
  const frame = (content: ReactNode) =>
    fold ? (
      <div
        role="button"
        tabIndex={0}
        onClick={fold}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fold();
          }
        }}
        aria-expanded={showRows}
        aria-label={showRows ? 'Hide categories' : 'See all categories'}
        data-testid={showRows ? 'hide-categories' : 'see-categories'}
        className="block w-full cursor-pointer"
      >
        {content}
      </div>
    ) : (
      content
    );
  const chart = second ? (
    <Deck page={page} onPage={onPage} labels={['Where the month went', 'Against budget']} frame={frame}>
      {donut}
      {second}
    </Deck>
  ) : (
    frame(donut)
  );

  return (
    <Card>
      {header}
      {/* No legend: the ring writes each name against its own slice, and the rows below name the rest. */}
      {chart}
      {showRows && (
        <div className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
          {ordered.map((node, index) => (
            <Row
              key={node.id}
              node={node}
              colour={colourById.get(node.id) ?? (colourOf ? colourOf(node, index) : categoryColour(node.id))}
              totalMinor={totalMinor}
              month={month}
              currency={currency}
              capMinor={caps?.[node.id]}
              against={caps ? 'budget' : 'month'}
              onOpen={onOpen && node.children.length > 0 ? () => onOpen(node) : undefined}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/**
 * Where a month's money went, by category: the list's transactions added up, except that a bill paid in another
 * month counts in the month of its bill (so August's internet paid on 3 September adds to August).
 *
 * It reads the month the page is already on, so switching between the list and this is a change of
 * view rather than a change of subject. A category with children opens into its own ring; one without
 * leads to the transactions behind it.
 */
export function SpendingReport({
  month,
  categoryId,
  kind,
  onKind,
  onPick,
  onMonth,
  alsoMissing = [],
}: {
  month: string;
  categoryId?: string;
  /** Money out or money in. The page holds it, so its list can be filtered to the same side. */
  kind: 'expense' | 'income';
  onKind: (kind: 'expense' | 'income') => void;
  onPick?: (id: string) => void;
  /** Given, the chart carries the month itself: the arrows step through them. */
  onMonth?: (month: string) => void;
  /** What the list below could not convert either. The chart says it once for the whole screen. */
  alsoMissing?: readonly UnconvertedRow[];
}) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const inOpenBook = useInOpenBook();
  // The categories are folded away until asked for: the list underneath is what most days are about.
  const [showAll, setShowAll] = useState(false);
  // Which of the two charts the card is turned to. The rows follow it, so one denominator is on screen at a time.
  const [page, setPage] = useState(0);
  const [picking, setPicking] = useState(false);
  // "month" is whatever period the page shows. All time is asked for as the widest possible stretch.
  const period = parsePeriod(month);
  const from = period?.from ?? '0000-01-01';
  const to = period?.to ?? '9999-12-31';
  // Budgets are monthly, so the budget page only exists when a single month is showing.
  const isMonth = period?.kind === 'month';
  const first = useQuery({ queryKey: ['first-transaction', ws.workspaceId], queryFn: () => firstTransactionDate(database, ws), enabled: picking });

  const totals = useQuery({
    queryKey: ['category-totals', ws.workspaceId, ws.bookId ?? null, kind, month, 'without-events'],
    // An event is read on its own: a week in Singapore would otherwise swallow the shape of an ordinary month.
    queryFn: () => categoryTotalsIn(database, ws, kind, from, to, { excludeEvents: true, billMonths: true }),
  });
  const budgets = useQuery({
    queryKey: ['budget-sheet', ws.workspaceId, ws.bookId ?? null, month],
    enabled: kind === 'expense' && isMonth,
    queryFn: () => budgetSheetFor(database, ws, month),
  });
  // A workspace reads its chart in its own currency; the owner's is the answer until the first read arrives.
  const currency = totals.data?.currency ?? ws.baseCurrency;
  const missing = mergeUnconverted(totals.data?.missing ?? [], alsoMissing);
  const progress = budgetProgress(budgets.data?.lines ?? []);
  // The budget page exists only where there is a budget to measure, and only for money going out.
  const hasBudgets = kind === 'expense' && isMonth && progress.any;
  const onBudgets = hasBudgets && page === 1;
  const caps: Record<string, number> = {};
  /** A category's budget, or what its children were budgeted between them: a parent row measures the lot. */
  const readCaps = (line: BudgetLine): number => {
    const under = line.children.reduce((sum, child) => sum + readCaps(child), 0);
    const own = line.capMinor ?? under;
    if (own > 0) caps[line.id] = own;
    return own;
  };
  if (budgets.data) for (const line of budgets.data.lines) readCaps(line);
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets().data ?? [];
  const ofKind = accounts.filter((a) => a.kind === kind);
  const amounts = (totals.data?.rows ?? []).map((row) => ({ accountId: row.accountId, amountBaseMinor: row.amountBaseMinor }));
  const countById = new Map((totals.data?.rows ?? []).map((row) => [row.accountId, row.transactions]));
  // The monthly tree is the open book's; each set is already narrowed to the book by useCategorySets.
  const tree = categoryTree(
    ofKind.filter((a) => membership[a.id] === undefined && inOpenBook(a)),
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

  /** The month arrows and the money-out/in switch. A month with nothing in it still needs the way back. */
  const header = (
    <div>
      {onMonth && (
        <div className="flex items-center justify-between">
          {/* Arrows step by whatever the period is — a week, a month, a quarter, a year. All time and two chosen dates have no neighbours. */}
          {stepPeriod(month, -1) ? (
            <Button variant="ghost" className="px-2 py-1" aria-label="Earlier period" onClick={() => onMonth(stepPeriod(month, -1)!)}>
              <ChevronLeft size={18} aria-hidden />
            </Button>
          ) : (
            <span className="w-9" />
          )}
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="inline-flex min-h-9 items-center gap-1 rounded-full bg-slate-100 px-3 text-sm font-semibold"
            data-testid="chart-month"
            aria-label={`${periodLabel(month)}, choose a period`}
          >
            {periodLabel(month)}
            <ChevronDown size={14} aria-hidden className="text-slate-500" />
          </button>
          {stepPeriod(month, 1) ? (
            <Button variant="ghost" className="px-2 py-1" aria-label="Later period" onClick={() => onMonth(stepPeriod(month, 1)!)}>
              <ChevronRight size={18} aria-hidden />
            </Button>
          ) : (
            <span className="w-9" />
          )}
        </div>
      )}
      {picking && onMonth && (
        <PeriodPicker value={month} years={yearsSince(first.data ?? null)} onPick={onMonth} onClose={() => setPicking(false)} />
      )}
      <div className="mt-5 flex gap-1.5">
        {(['expense', 'income'] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => onKind(k)}
            // Named apart from what it says: the form on this same page already has an "Income" button.
            aria-label={k === 'expense' ? 'Show expenses' : 'Show income'}
            className={cx('min-h-9 flex-1 rounded-lg text-sm font-medium', kind === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600')}
          >
            {k === 'expense' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="spending-report">
      <Unconverted missing={missing} currency={currency} />
      {open ? (
        <Ring
          nodes={open.ownMinor > 0 ? [...open.children, { id: open.id, name: `${open.name} (general)`, ownMinor: open.ownMinor, totalMinor: open.ownMinor, children: [] }] : open.children}
          totalMinor={open.totalMinor}
          middleLabel={open.name}
          month={month}
          currency={currency}
          transactions={countIn(open)}
          showRows
          colourOf={(_, index) => shade(categoryColour(open.id), index, Math.max(2, open.children.length))}
        />
      ) : (
        <>
          <div data-testid="period-total" className="sr-only">
            <Money minor={total} currency={currency} />
          </div>
          {totals.isSuccess && tree.length === 0 && setGroups.length === 0 ? (
            <Card>
              {header}
              <Empty>Nothing recorded for {periodLabel(month)}.</Empty>
            </Card>
          ) : (
            <Ring
              nodes={tree}
              extra={setGroups.map((group) => ({ key: `set:${group.set.id}`, label: group.set.name, totalMinor: group.tree.reduce((sum, node) => sum + node.totalMinor, 0) }))}
              totalMinor={total}
              middleLabel={kind === 'expense' ? 'Total spent' : 'Total earned'}
              month={month}
              currency={currency}
              transactions={transactions}
              caps={onBudgets ? caps : undefined}
              header={header}
              second={hasBudgets ? <BudgetGauge progress={progress} month={month} today={isoDate()} /> : undefined}
              page={page}
              onPage={setPage}
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
                    <Row key={node.id} node={node} colour={categoryColour(node.id)} totalMinor={total} month={month} currency={currency} capMinor={onBudgets ? caps[node.id] : undefined} against={onBudgets ? 'budget' : 'month'} />
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
