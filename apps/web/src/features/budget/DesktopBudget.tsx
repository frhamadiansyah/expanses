import { addMonths, type BudgetLine, isoDate, periodMonthOf } from '@expanses/core';
import { BudgetError, type BudgetRow, saveBudgets } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useResolvedNeeds } from '../essential-split/queries';
import { bareFigure } from '../networth/debt-rows';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { countsAs as countsAsOf } from '../transactions/cashflow-desk-model';
import { useBooks, useMonthStart, useOpenBook } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { GoalsBox, LookBox, MonthBudgetBox, MonthSoFarBox, SplitBox, TakeHomeBox } from './BudgetBoxes';
import { cellText, type DeskRow, type DeskView, deskTable, needsALook, planCell, shownRows } from './budget-desk-model';
import { daysLeft, findLine, spendingView } from './budget-view';
import { TakeHomeSheet } from './BudgetSheets';
import { CapSheet } from './CapSheet';
import { CategoryPeek, TONE_COLOUR } from './CategoryPeek';
import { useBudgets, useBudgetSheet, useCommittedBills, useSpendingHistory } from './queries';
import { dependantsOf, shareBaseOf } from './share-form';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const GBTN = 'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
const SEGMENTS: { value: DeskView; label: string }[] = [
  { value: 'spending', label: 'Spending' },
  { value: 'plan', label: 'Plan' },
];

/** Folded groups are this browser's own convenience, kept across visits; a store that cannot be read starts all open. */
const FOLDS_KEY = 'budget-desk-folded';
function readFolds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FOLDS_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeFolds(folds: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(FOLDS_KEY, JSON.stringify([...folds]));
  } catch {
    // Kept for this visit only.
  }
}

type Open = { kind: 'cap'; id: string } | { kind: 'take-home' } | null;

/** The name of the line directly above this one, or null for a root. */
function parentNameOf(lines: readonly BudgetLine[], id: string): string | null {
  for (const line of lines) {
    if (line.children.some((child) => child.id === id)) return line.name;
    const found = parentNameOf(line.children, id);
    if (found) return found;
  }
  return null;
}

/** "−1.200.000" for a figure below nought. */
const signed = (minor: number, currency: string) => (minor < 0 ? `−${bareFigure(-minor, currency)}` : bareFigure(minor, currency));

/**
 * Budget on a wide screen (Mac Budget, the list version, owner-picked 2026-11-17): a title bar with Spending · Plan, the
 * month and Edit budgets; three boxes in the Overview's style; and every category in one table, whose Budget cells take
 * a figure typed straight in (an amount, or a %) and whose names open the category's side peek. The phone's Budget is
 * not this page — `BudgetPage` draws it as before.
 */
export function DesktopBudget() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const asked = useSearch({ strict: false }) as { month?: string };
  const monthStart = useMonthStart();
  const [picked, setMonth] = useState<string | null>(asked.month ?? null);
  const month = picked ?? periodMonthOf(today, monthStart);
  const [tab, setTab] = useState<DeskView>('spending');
  const [open, setOpen] = useState<Open>(null);

  const accounts = useAccounts().data ?? [];
  const sheetQuery = useBudgetSheet(month);
  const sheet = sheetQuery.data;
  const budgets = useBudgets(month).data;
  const committed = useCommittedBills().data ?? {};
  // A budget is typed in the workspace's own money, and not before its row has been read (as Edit budgets).
  const openBook = useOpenBook();
  const planCurrency = openBook?.baseCurrency ?? ws.baseCurrency;
  const planReady = useBooks().isSuccess;
  const currency = sheet?.currency ?? planCurrency;
  const history = useSpendingHistory(month, currency);
  const needs = useResolvedNeeds().data;

  const view = sheet ? spendingView(sheet.lines) : null;
  const table = sheet ? deskTable(sheet.lines, budgets ?? []) : null;
  const [folded, setFolded] = useState<Set<string>>(readFolds);
  const rows = table ? shownRows(table.rows, folded) : [];
  const days = daysLeft(month, today, monthStart);
  const daysNote = days === null ? null : days === 1 ? '1 day left' : `${days} days left`;
  const thisMonth = month === periodMonthOf(today, monthStart);
  const storedOf = (id: string): BudgetRow | undefined => budgets?.find((row) => row.categoryAccountId === id);

  const toggleFold = (id: string) =>
    setFolded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFolds(next);
      return next;
    });

  // The side peek: which category it shows, stepped through the table's own order (a parent's group row and its own
  // budget are the one category).
  const [peekId, setPeekId] = useState<string | null>(null);
  const peekIds = [...new Set(rows.map((row) => row.categoryId))];
  const peekLine = peekId && sheet ? findLine(sheet.lines, peekId) : undefined;
  useEffect(() => {
    if (peekId && sheet && !findLine(sheet.lines, peekId)) setPeekId(null);
  }, [peekId, sheet]);
  const step = (by: -1 | 1) => {
    if (!peekId) return;
    const at = peekIds.indexOf(peekId);
    const next = peekIds[Math.min(peekIds.length - 1, Math.max(0, at + by))];
    if (next) setPeekId(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
  const peeking = peekId !== null;
  useEffect(() => {
    if (!peeking) return;
    const place = () => setPeekTop(Math.max(0, bar.current?.getBoundingClientRect().bottom ?? 52));
    place();
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
    };
  }, [peeking]);

  // Typing in a Budget cell: which row is open, what is typed, and why the last Return was refused.
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const [cellError, setCellError] = useState<{ key: string; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Read by the cell's blur too, which can fire while a save is under way (the field disables, then unmounts).
  const savingRef = useRef(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const editable = rows.filter((row) => row.kind === 'line');
  const editBudgets = () => void navigate({ to: '/budget/edit', search: { month } });

  const begin = (row: DeskRow) => {
    setCellError(null);
    if (row.edit === 'editor') return editBudgets();
    if (row.edit === 'sheet') return setOpen({ kind: 'cap', id: row.categoryId });
    setEditing({ key: row.key, text: cellText(storedOf(row.categoryId), planCurrency) });
  };
  const neighbour = (key: string, by: -1 | 1, cellsOnly: boolean): DeskRow | undefined => {
    const list = cellsOnly ? editable.filter((row) => row.edit === 'cell') : editable;
    const at = list.findIndex((row) => row.key === key);
    return at < 0 ? undefined : list[at + by];
  };
  const focusCell = (key: string) => requestAnimationFrame(() => cells.current.get(key)?.focus());

  async function commit(row: DeskRow, text: string, then: -1 | 1 | null) {
    if (!sheet || !budgets || !planReady || savingRef.current) return;
    const next = then === null ? undefined : neighbour(row.key, then, true);
    const plan = planCell(sheet.lines, budgets, row.categoryId, text, sheet.incomePlanMinor, planCurrency);
    if (plan.kind === 'error') {
      setCellError({ key: row.key, message: plan.message });
      return;
    }
    if (plan.kind === 'editor') {
      setEditing(null);
      editBudgets();
      return;
    }
    if (plan.kind === 'save') {
      try {
        savingRef.current = true;
        setSaving(true);
        await saveBudgets(database, ws, plan.changes, month);
        await invalidate();
      } catch (e) {
        setCellError({ key: row.key, message: e instanceof BudgetError || e instanceof Error ? e.message : 'That budget could not be saved' });
        return;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }
    setCellError(null);
    if (next) setEditing({ key: next.key, text: cellText(storedOf(next.categoryId), planCurrency) });
    else {
      setEditing(null);
      focusCell(row.key);
    }
  }
  const cancel = (row: DeskRow) => {
    setEditing(null);
    setCellError(null);
    focusCell(row.key);
  };

  // Keys for the whole page while the peek is open: Esc closes it, ↑ ↓ step — never while typing, or under a sheet.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peekId) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || open || document.querySelector('[role="dialog"]')) return;
    // A Budget cell's own arrows move between cells (and take the peek with them).
    if (target?.dataset.budgetCell) return;
    if (event.key === 'Escape') setPeekId(null);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'ArrowDown') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  const setFirst = () => {
    document.getElementById('budget-no-budget')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const first = table?.rows.find((row) => row.section === 'none');
    if (first) focusCell(first.key);
  };
  const counts = (categoryId: string) => countsAsOf({ type: 'expense', categoryId }, needs);
  const look = sheet && table ? needsALook(sheet.lines, table.noBudgetCount) : [];
  const peekStored = peekLine ? storedOf(peekLine.id) : undefined;
  const peekParent = peekLine && sheet ? parentNameOf(sheet.lines, peekLine.id) : null;
  const compact = peekLine !== undefined;
  const columns = compact ? 4 : 6;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="budget-page" data-desk="true">
      <header ref={bar} className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Budget</h1>
        <span className="flex-1" />
        <div role="radiogroup" aria-label="Budget view" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
          {SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              role="radio"
              aria-checked={tab === segment.value}
              onClick={() => setTab(segment.value)}
              className={cx(
                'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
                tab === segment.value ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-[2px] text-[13px] text-[var(--ph-ink)]">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <span data-testid="budget-month" className="px-1 whitespace-nowrap tabular-nums">
            {monthLabel(month)}
          </span>
          <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]">
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <button type="button" onClick={editBudgets} className="flex h-[26px] items-center rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]">
          Edit budgets
        </button>
      </header>

      {/*
       * While the peek is open the whole page makes room for it, boxes and table alike, so it covers no figure; the boxes
       * go by the room they have (a container query, not the window's width), so they wrap rather than squeeze. Two
       * across, the first box (the gauge and its figures) takes the whole row and the other two share the next.
       */}
      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peekLine && 'mr-[322px]')}>
        <ErrorBox error={sheetQuery.error} />
        <Unconverted missing={sheet?.unconverted ?? []} currency={currency} />
        {sheet && view && (
          <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[478px]:grid-cols-2 @min-[478px]:[&>:first-child]:col-span-2 @min-[990px]:grid-cols-[1.45fr_1fr_0.95fr] @min-[990px]:[&>:first-child]:col-span-1">
            {tab === 'spending' ? (
              <>
                <MonthBudgetBox title={thisMonth ? 'This month’s budget' : `${monthLabel(month)} budget`} sheet={sheet} view={view} currency={currency} month={month} today={today} monthStart={monthStart} daysNote={daysNote} />
                <SplitBox sheet={sheet} currency={currency} />
                <LookBox lines={look} currency={currency} daysNote={daysNote} accounts={accounts} onOpen={setPeekId} onSet={setFirst} />
              </>
            ) : (
              <>
                <TakeHomeBox sheet={sheet} currency={currency} onTakeHome={() => setOpen({ kind: 'take-home' })} />
                <GoalsBox sheet={sheet} currency={currency} />
                <MonthSoFarBox sheet={sheet} currency={currency} />
              </>
            )}
          </div>
        )}

        {sheet && table && (
          <section className={cx(BOX, 'overflow-hidden [contain:inline-size]')} aria-label="Categories">
            <h2 className="flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]">
              Categories
              <span className={NOTE}>Type a budget into its cell (an amount, or a % of its parent) · Tab moves down · ▼ folds a group</span>
            </h2>
            <div className="overflow-x-auto border-t border-[var(--ph-hair)]">
              {/* With the peek open the table makes room for it: Counts as (the peek says it) and the bar step aside. */}
              <table className={cx('w-full table-fixed border-collapse text-[13px]', compact ? 'min-w-[540px]' : 'min-w-[820px]')}>
                <colgroup>
                  <col />
                  {tab === 'plan' && <col className="w-[150px]" />}
                  {!compact && <col className="w-[120px]" />}
                  {tab === 'spending' && <col className="w-[150px]" />}
                  <col className="w-[120px]" />
                  <col className="w-[120px]" />
                  {!compact && <col className="w-[170px]" />}
                </colgroup>
                <thead>
                  <tr className="bg-[var(--mac-head)] text-[11px] font-semibold text-[var(--ph-ink-3)]">
                    <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-left font-semibold">Category</th>
                    {tab === 'plan' && <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-right font-semibold">Budget</th>}
                    {!compact && <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-left font-semibold">Counts as</th>}
                    {tab === 'spending' && <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-right font-semibold">Budget</th>}
                    <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-right font-semibold">Spent</th>
                    <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px] text-right font-semibold">Left</th>
                    {!compact && (
                      <th className="border-b border-[var(--ph-hair)] px-[10px] py-[7px]">
                        <span className="sr-only">Used</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={columns} className="px-3 py-6 text-center text-[13px] text-[var(--ph-ink-3)]">
                        Nothing budgeted and nothing spent in {monthLabel(month)}.{' '}
                        <button type="button" onClick={editBudgets} className="text-[var(--mac-accent)] hover:underline">
                          Edit budgets
                        </button>{' '}
                        sets a budget for any category.
                      </td>
                    </tr>
                  )}
                  {rows.map((row, index) => {
                    const first = row.section === 'none' && rows[index - 1]?.section !== 'none';
                    return [
                      first ? (
                        <tr key="no-budget-head" id="budget-no-budget">
                          <td colSpan={columns} className="bg-[var(--ph-surface)] px-[10px] pt-[12px] pb-[4px] text-[11px] font-semibold tracking-[0.04em] text-[var(--ph-ink-3)] uppercase">
                            No budget yet
                          </td>
                        </tr>
                      ) : null,
                      <BudgetTableRow
                        key={row.key}
                        row={row}
                        tab={tab}
                        compact={compact}
                        striped={index % 2 === 1}
                        currency={currency}
                        accounts={accounts}
                        counts={counts(row.categoryId)}
                        folded={folded.has(row.categoryId)}
                        peeked={peekId === row.categoryId}
                        editing={editing?.key === row.key ? editing.text : null}
                        error={cellError?.key === row.key ? cellError.message : null}
                        saving={saving}
                        register={(button) => {
                          if (button) cells.current.set(row.key, button);
                          else cells.current.delete(row.key);
                        }}
                        onFold={() => toggleFold(row.categoryId)}
                        onPeek={() => setPeekId(row.categoryId)}
                        onBegin={() => begin(row)}
                        onType={(text) => {
                          setCellError(null);
                          setEditing({ key: row.key, text });
                        }}
                        onCommit={(then) => {
                          const typing = editingRef.current;
                          if (typing?.key === row.key) void commit(row, typing.text, then);
                        }}
                        onCancel={() => cancel(row)}
                        onArrow={(by) => {
                          const next = neighbour(row.key, by, false);
                          if (!next) return;
                          focusCell(next.key);
                          if (peekId) setPeekId(next.categoryId);
                        }}
                      />,
                    ];
                  })}
                  {table.rows.some((row) => row.section === 'budgeted') && (
                    <tr data-testid="budget-total" className="border-t border-[var(--ph-hair)] bg-[var(--ph-surface)] font-semibold text-[var(--ph-ink)]">
                      <td className="px-[10px] py-[7px]">Total budgeted</td>
                      {tab === 'plan' && <td data-testid="total-budget" className="px-[10px] py-[7px] text-right tabular-nums">{bareFigure(table.total.budgetMinor, currency)}</td>}
                      {!compact && <td />}
                      {tab === 'spending' && <td data-testid="total-budget" className="px-[10px] py-[7px] text-right tabular-nums">{bareFigure(table.total.budgetMinor, currency)}</td>}
                      <td data-testid="total-spent" className="px-[10px] py-[7px] text-right tabular-nums">{bareFigure(table.total.spentMinor, currency)}</td>
                      <td data-testid="total-left" className={cx('px-[10px] py-[7px] text-right tabular-nums', table.total.leftMinor < 0 && 'text-[var(--ph-alarm)]')}>
                        {signed(table.total.leftMinor, currency)}
                      </td>
                      {!compact && <td />}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {peekLine && sheet && (
        <CategoryPeek
          key={peekLine.id}
          top={peekTop}
          line={peekLine}
          stored={peekStored}
          parentName={peekParent}
          countsAs={counts(peekLine.id)}
          history={history?.get(peekLine.id) ?? null}
          month={month}
          currency={currency}
          accounts={accounts}
          first={peekIds.indexOf(peekLine.id) <= 0}
          last={peekIds.indexOf(peekLine.id) === peekIds.length - 1}
          onStep={step}
          onClose={() => setPeekId(null)}
          onEditBudget={() => setOpen({ kind: 'cap', id: peekLine.id })}
        />
      )}
      {open?.kind === 'cap' && sheet && (
        <CapSheet
          key={open.id}
          categoryId={open.id}
          name={findLine(sheet.lines, open.id)?.name ?? 'Budget'}
          history={history?.get(open.id) ?? null}
          base={shareBaseOf(sheet.lines, open.id, sheet.incomePlanMinor, storedOf(open.id)?.share ?? null)}
          dependants={dependantsOf(sheet.lines, budgets ?? [], open.id)}
          month={month}
          currency={planCurrency}
          ready={planReady}
          lineOf={(id) => findLine(sheet.lines, id)}
          rowOf={storedOf}
          committed={committed}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === 'take-home' && sheet && <TakeHomeSheet sheet={sheet} month={month} currency={planCurrency} ready={planReady} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One row of the Categories table: a group with its fold, or a category whose Budget cell is typed into in place. */
function BudgetTableRow({
  row,
  tab,
  compact,
  striped,
  currency,
  accounts,
  counts,
  folded,
  peeked,
  editing,
  error,
  saving,
  register,
  onFold,
  onPeek,
  onBegin,
  onType,
  onCommit,
  onCancel,
  onArrow,
}: {
  row: DeskRow;
  tab: DeskView;
  /** The peek is open: no Counts as, no bar. */
  compact: boolean;
  striped: boolean;
  currency: string;
  accounts: Parameters<typeof CategoryIcon>[0]['accounts'];
  counts: string;
  folded: boolean;
  peeked: boolean;
  /** What is typed in its Budget cell, or null when the cell is not open. */
  editing: string | null;
  error: string | null;
  saving: boolean;
  register: (button: HTMLButtonElement | null) => void;
  onFold: () => void;
  onPeek: () => void;
  onBegin: () => void;
  onType: (text: string) => void;
  onCommit: (then: -1 | 1 | null) => void;
  onCancel: () => void;
  onArrow: (by: -1 | 1) => void;
}) {
  const group = row.kind === 'group';
  const strong = group ? 'font-semibold' : '';
  // A budgeted root reads as a heading of its own, as a group does; its figures stay plain.
  const named = group || (row.section === 'budgeted' && row.depth === 0) ? 'font-semibold' : '';
  const cell = 'px-[10px] py-[5px] whitespace-nowrap';
  const budget: ReactNode =
    group ? (
      <span className="font-semibold">{bareFigure(row.budgetMinor ?? 0, currency)}</span>
    ) : editing !== null ? (
      <span className="block">
        <input
          autoFocus
          aria-label={`Budget for ${row.label}`}
          value={editing}
          disabled={saving}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => onType(event.target.value)}
          onBlur={() => onCommit(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit(null);
            } else if (event.key === 'Tab') {
              event.preventDefault();
              onCommit(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          placeholder="Amount or %"
          inputMode="decimal"
          className="-my-px h-[20px] w-full rounded-[4px] bg-[var(--ph-surface)] px-[6px] text-right text-[13px] text-[var(--ph-ink)] tabular-nums outline-2 outline-[var(--mac-accent)] placeholder:text-[var(--ph-ink-3)]"
        />
        {error && (
          <span role="alert" className="absolute right-[10px] z-10 mt-[3px] max-w-[260px] rounded-[6px] bg-[var(--ph-alarm)] px-[8px] py-[3px] text-left text-[11.5px] whitespace-normal text-white shadow">
            {error}
          </span>
        )}
      </span>
    ) : (
      <button
        ref={register}
        type="button"
        data-budget-cell="true"
        aria-label={`Budget for ${row.label}`}
        title={row.edit === 'editor' ? `Set ${row.frequency}: opens Edit budgets` : row.edit === 'sheet' ? 'This month has its own figure' : 'Type a budget (an amount, or a %)'}
        onClick={onBegin}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            onArrow(event.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        className="w-full rounded-[4px] text-right tabular-nums hover:bg-[var(--ph-fill)] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]"
      >
        {row.budgetMinor === null ? (
          <span className="text-[var(--ph-chevron)]">Set…</span>
        ) : (
          <>
            {(row.percent || row.frequency !== 'monthly' || row.overridden) && (
              <span className="text-[11.5px] text-[var(--ph-ink-3)]">{row.overridden ? 'this month' : row.percent ?? row.frequency} · </span>
            )}
            <span className="text-[var(--mac-accent)]">{bareFigure(row.budgetMinor, currency)}</span>
          </>
        )}
      </button>
    );
  const budgetCell = (
    <td data-testid="budget-cell" className={cx(cell, 'relative text-right')}>
      {budget}
    </td>
  );
  return (
    <tr
      data-testid={`budget-row-${row.label}`}
      data-category-id={row.categoryId}
      aria-current={peeked && !group ? 'true' : undefined}
      className={cx('text-[var(--ph-ink)]', group ? 'bg-[var(--mac-head)]' : striped && 'bg-[var(--mac-zebra)]', peeked && !group && 'shadow-[inset_3px_0_0_var(--mac-accent)]')}
    >
      <td className={cx(cell, 'overflow-hidden')} style={{ paddingLeft: 10 + row.depth * 24 }}>
        <span className="flex min-w-0 items-center gap-[6px]">
          {group ? (
            <button
              type="button"
              aria-expanded={!folded}
              aria-label={folded ? `Unfold ${row.label}` : `Fold ${row.label}`}
              onClick={onFold}
              className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-[10px] text-[var(--ph-ink-3)] hover:text-[var(--ph-ink)]"
            >
              {folded ? '▶' : '▼'}
            </button>
          ) : (
            <span aria-hidden className="w-[16px] shrink-0" />
          )}
          <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="xs" />
          <button type="button" onClick={onPeek} title={`See ${row.name}’s transactions`} className={cx('min-w-0 truncate text-left hover:underline', named)}>
            {row.label}
          </button>
        </span>
      </td>
      {tab === 'plan' && budgetCell}
      {!compact && <td className={cx(cell, 'text-[var(--ph-ink-3)]')}>{counts}</td>}
      {tab === 'spending' && budgetCell}
      <td data-testid="spent-cell" className={cx(cell, 'text-right tabular-nums', strong)}>
        {bareFigure(row.spentMinor, currency)}
      </td>
      <td data-testid="left-cell" className={cx(cell, 'text-right tabular-nums', strong, row.leftMinor !== null && row.leftMinor < 0 && 'text-[var(--ph-alarm)]')}>
        {row.leftMinor === null ? <span className="text-[var(--ph-ink-3)]">—</span> : signed(row.leftMinor, currency)}
      </td>
      {!compact && (
      <td className={cell}>
        {row.tone && (
          <div aria-hidden className="h-[6px] overflow-hidden rounded-full bg-[var(--ph-track)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(1, row.share) * 100}%`, background: TONE_COLOUR[row.tone] }} />
          </div>
        )}
      </td>
      )}
    </tr>
  );
}

