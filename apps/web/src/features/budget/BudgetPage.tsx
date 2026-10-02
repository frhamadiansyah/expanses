import { addMonths, formatMinor, isoDate, monthOf } from '@expanses/core';
import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Plus, Scale, Target } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx, ErrorBox, Money } from '../../ui';
import { type CornerAction, Drawer, InsetGroup, InsetRow, LargeTitle, Panel, SCREEN, SegmentedControl, useDrawers } from '../../ui/native';
import { useCategorySetMembership } from '../categories/set-queries';
import { useBooks, useOpenBook } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { CappedRow, FigureRow, OverRow, UseBar, useCategoryMarks } from './budget-rows';
import { daysLeft, findLine, planSplit, spendingView } from './budget-view';
import { MonthSheet, NoBudgetSheet, SplitSheet, TakeHomeSheet } from './BudgetSheets';
import { CapSheet } from './CapSheet';
import { useBudgets, useBudgetSheet, useCommittedBills } from './queries';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

type Tab = 'spending' | 'plan';
type Open = { kind: 'cap'; id: string | null } | { kind: 'take-home' } | { kind: 'split' } | { kind: 'month' } | { kind: 'no-budget' } | null;

/** ‹ October 2026 ›, as Cashflow steps its months. */
function MonthPicker({ month, onMonth }: { month: string; onMonth: (month: string) => void }) {
  const arrow = 'ph-focus flex h-11 w-11 items-center justify-center rounded-full text-[var(--ph-ink-2)]';
  return (
    <div className="mb-3 flex w-full items-center justify-between md:max-w-2xl">
      <button type="button" className={arrow} aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}>
        <ChevronLeft size={20} aria-hidden />
      </button>
      <span className="inline-flex min-h-9 items-center rounded-full bg-[var(--ph-fill)] px-4 text-sm font-semibold text-[var(--ph-ink)]" data-testid="budget-month">
        {monthLabel(month)}
      </span>
      <button type="button" className={arrow} aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}>
        <ChevronRight size={20} aria-hidden />
      </button>
    </div>
  );
}

/** The figure card at the head of a tab: a small label, one large figure, and what explains it under that. */
function FigureCard({ label, figure, warn = false, testId, children }: { label: string; figure: string; warn?: boolean; testId: string; children: ReactNode }) {
  return (
    <Panel className="space-y-3" testId={testId}>
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">{label}</p>
        <p className={cx('tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em]', warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink)]')} data-testid="card-figure">
          {figure}
        </p>
      </div>
      {children}
    </Panel>
  );
}

/** A tinted category circle, drawn inside a drawer's own circle so the drawer wears the category's colour too. */
function TintedGlyph({ icon, colour }: { icon: ReactNode; colour: string }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${colour} 12%, var(--ph-surface))`, color: colour }}>
      {icon}
    </span>
  );
}

const PLAN_COLOURS = { debt: 'var(--ph-ink-2)', goals: 'var(--ph-info-ink)', budgeted: 'var(--ph-tint)', unplanned: 'var(--ph-track)' } as const;

export function BudgetPage() {
  const { ws } = useApp();
  const today = isoDate();
  const [month, setMonth] = useState(monthOf(today));
  const [tab, setTab] = useState<Tab>('spending');
  const [open, setOpen] = useState<Open>(null);
  const drawers = useDrawers();

  const accounts = useAccounts().data ?? [];
  const markOf = useCategoryMarks(accounts);
  const membership = useCategorySetMembership().data ?? {};
  // Caps are for the monthly tree, and the open book's: an event plans its set on its own page.
  const inOpenBook = useInOpenBook();
  const categories = accounts.filter((account) => account.kind === 'expense' && membership[account.id] === undefined && inOpenBook(account));
  const sheetQuery = useBudgetSheet(month);
  const sheet = sheetQuery.data;
  const budgets = useBudgets(month).data ?? [];
  const committed = useCommittedBills().data ?? {};
  // A cap and the take-home are typed in the workspace's own money, read from its own row — and not until that row
  // has been read, or a cap typed in a workspace that reads in dollars would be parsed as rupiah.
  const openBook = useOpenBook();
  const planCurrency = openBook?.baseCurrency ?? ws.baseCurrency;
  const planReady = useBooks().isSuccess;
  const currency = sheet?.currency ?? planCurrency;

  // Roots first, each followed by its children, so the choice reads like the tree.
  const options = categories
    .filter((account) => !categories.some((parent) => parent.id === account.parentId))
    .flatMap((root) => [
      { id: root.id, label: root.name },
      ...categories.filter((child) => child.parentId === root.id).map((child) => ({ id: child.id, label: `— ${child.name}` })),
    ]);

  const view = sheet ? spendingView(sheet.lines) : null;
  const openCap = (id: string | null) => setOpen({ kind: 'cap', id });
  const close = () => setOpen(null);

  const menu: CornerAction[] = [
    { key: 'add', label: 'Add a budget', glyph: <Plus size={18} aria-hidden />, run: () => openCap(null) },
    { key: 'split', label: 'Essential and lifestyle', glyph: <Scale size={18} aria-hidden />, run: () => setOpen({ kind: 'split' }), disabled: !sheet },
    { key: 'month', label: 'Month so far', glyph: <CalendarDays size={18} aria-hidden />, run: () => setOpen({ kind: 'month' }), disabled: !sheet },
  ];
  const actions: CornerAction[] = [{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu }];

  const left = sheet && view ? sheet.capsTotalMinor - view.spentMinor : 0;
  const days = daysLeft(month, today);

  return (
    <div className={SCREEN} data-testid="budget-page">
      <LargeTitle title="Budget" actions={actions} />
      <MonthPicker month={month} onMonth={setMonth} />
      <div className="mb-4 w-full md:max-w-2xl">
        <SegmentedControl
          label="Budget view"
          segments={[
            { key: 'spending', label: 'Spending' },
            { key: 'plan', label: 'Plan' },
          ]}
          value={tab}
          onChange={(key) => setTab(key as Tab)}
        />
      </div>

      <ErrorBox error={sheetQuery.error} />
      <Unconverted missing={sheet?.unconverted ?? []} currency={currency} />

      {sheet && view && tab === 'spending' && (
        <>
          <FigureCard label="Left to spend" figure={left < 0 ? `Over by ${formatMinor(-left, currency)}` : formatMinor(left, currency)} warn={left < 0} testId="left-to-spend">
            <UseBar share={sheet.capsTotalMinor > 0 ? view.spentMinor / sheet.capsTotalMinor : view.spentMinor > 0 ? 2 : 0} height={6} label="Spent of the budget" />
            <div className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
              <span data-testid="spent-of-budget">
                Spent <Money minor={view.spentMinor} currency={currency} /> of <Money minor={sheet.capsTotalMinor} currency={currency} />
              </span>
              {days !== null && <span className="shrink-0">{days === 1 ? '1 day left' : `${days} days left`}</span>}
            </div>
          </FigureCard>

          {view.over.length > 0 && (
            <InsetGroup header="Over the cap">
              {view.over.map((line) => (
                <OverRow key={line.id} line={line} mark={markOf(line.id)} currency={currency} onOpen={() => openCap(line.id)} />
              ))}
            </InsetGroup>
          )}

          <InsetGroup header="Budgeted">
            {view.budgeted.length === 0 ? (
              <InsetRow title={<span className="font-normal text-[var(--ph-tint)]">Add a budget</span>} chevron={false} onClick={() => openCap(null)} label="Add a budget" />
            ) : (
              view.budgeted.flatMap((entry, index) => {
                if (entry.kind === 'line') {
                  return [<CappedRow key={entry.line.id} line={entry.line} mark={markOf(entry.line.id)} currency={currency} onOpen={() => openCap(entry.line.id)} />];
                }
                const key = entry.parent.id;
                const shown = drawers.open.has(key);
                const mark = markOf(entry.parent.id);
                return [
                  <Drawer
                    key={key}
                    icon={<TintedGlyph icon={mark.icon} colour={mark.colour} />}
                    label={entry.parent.name}
                    figure={
                      <span className="tabular shrink-0 text-[15px] leading-[20px] whitespace-nowrap text-[var(--ph-ink)]">
                        <Money minor={entry.leftMinor} currency={currency} /> <span className="text-[var(--ph-ink-3)]">left</span>
                      </span>
                    }
                    open={shown}
                    separator={index > 0}
                    testId={`drawer-${entry.parent.name}`}
                    onToggle={() => drawers.toggle(key)}
                  />,
                  ...(shown
                    ? entry.lines.map((line) => (
                        <CappedRow
                          key={line.id}
                          line={line}
                          mark={null}
                          depth={1}
                          title={line.id === entry.parent.id ? `All ${line.name}` : line.name}
                          currency={currency}
                          onOpen={() => openCap(line.id)}
                        />
                      ))
                    : []),
                ];
              })
            )}
          </InsetGroup>

          {view.noBudget.length > 0 && (
            <InsetGroup>
              <InsetRow
                testId="no-budget"
                title="No budget"
                value={
                  <>
                    {view.noBudget.length === 1 ? '1 category' : `${view.noBudget.length} categories`} · <Money minor={view.noBudgetMinor} currency={currency} />
                  </>
                }
                onClick={() => setOpen({ kind: 'no-budget' })}
              />
            </InsetGroup>
          )}
        </>
      )}

      {sheet && tab === 'plan' && (
        <>
          <FigureCard label="Take-home" figure={formatMinor(sheet.incomePlanMinor, currency)} testId="take-home-card">
            {(() => {
              const split = planSplit({
                incomeMinor: sheet.incomePlanMinor,
                debtMinor: sheet.debtPaymentsPlanMinor,
                goalsMinor: sheet.savingsPlanMinor,
                budgetedMinor: sheet.capsTotalMinor,
              });
              return (
                <>
                  <span aria-hidden className="flex h-[8px] w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]">
                    {split.scaleMinor > 0 &&
                      split.parts
                        .filter((part) => part.minor > 0)
                        .map((part) => <span key={part.key} className="block h-full" style={{ width: `${(part.minor / split.scaleMinor) * 100}%`, background: PLAN_COLOURS[part.key] }} />)}
                  </span>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="plan-legend">
                    {split.parts.map((part) => (
                      <li key={part.key} className="flex items-center gap-[6px]">
                        <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: PLAN_COLOURS[part.key] }} />
                        {part.label} {part.percent === null ? '—' : `${part.percent}%`}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
          </FigureCard>

          <InsetGroup>
            <InsetRow
              testId="income-line"
              title="Take-home"
              subtitle={sheet.incomeOverridden ? 'Just this month' : undefined}
              value={<Money minor={sheet.incomePlanMinor} currency={currency} />}
              valueTone="ink"
              onClick={() => setOpen({ kind: 'take-home' })}
            />
            <FigureRow label="Debt payments" info="Loans and instalments are paid first, before anything else." value={<Money minor={sheet.debtPaymentsPlanMinor} currency={currency} />} testId="debt-line" />
            <FigureRow label="Budgeted" value={<Money minor={sheet.capsTotalMinor} currency={currency} />} testId="caps-total" />
            <FigureRow label="Unplanned" value={<Money minor={sheet.leftOverPlanMinor} currency={currency} />} dim testId="left-over-plan" />
            {sheet.eventSpendingMinor > 0 && (
              <FigureRow
                label="Events"
                info={
                  sheet.eventsInCaps
                    ? 'Inside the caps: this workspace counts event spending in its budget.'
                    : 'Outside the caps, as money meant to be spent. Still taken off what is left.'
                }
                value={<Money minor={sheet.eventSpendingMinor} currency={currency} />}
                testId="event-line"
              />
            )}
          </InsetGroup>

          {sheet.savings.length > 0 && (
            <InsetGroup header="Goals">
              {sheet.savings.map((row) => (
                <InsetRow
                  key={row.goalId}
                  testId={`savings-${row.name}`}
                  icon={<Target size={15} strokeWidth={2.2} aria-hidden />}
                  iconColour="var(--ph-tint)"
                  title={row.name}
                  subtitle={`${formatMinor(row.planMinor, currency)} a month`}
                  value={<Money minor={row.actualMinor} currency={currency} />}
                  valueTone="ink"
                  chevron={false}
                />
              ))}
            </InsetGroup>
          )}
        </>
      )}

      {open?.kind === 'cap' && (
        <CapSheet
          key={open.id ?? 'new'}
          categoryId={open.id}
          options={options}
          month={month}
          currency={planCurrency}
          ready={planReady}
          lineOf={(id) => (sheet ? findLine(sheet.lines, id) : undefined)}
          rowOf={(id) => budgets.find((row) => row.categoryAccountId === id)}
          committed={committed}
          onClose={close}
        />
      )}
      {open?.kind === 'take-home' && sheet && <TakeHomeSheet sheet={sheet} month={month} currency={planCurrency} ready={planReady} onClose={close} />}
      {open?.kind === 'split' && sheet && <SplitSheet sheet={sheet} currency={currency} onClose={close} />}
      {open?.kind === 'month' && sheet && <MonthSheet sheet={sheet} currency={currency} onClose={close} />}
      {open?.kind === 'no-budget' && view && (
        <NoBudgetSheet entries={view.noBudget} currency={currency} markOf={markOf} onPick={(id) => openCap(id)} onClose={close} />
      )}
    </div>
  );
}
