import { DeskNotices } from '../../app/DeskNotices';
import { addMonths, type BudgetLine, capsByNeed, formatMinor, isoDate, monthPeriod, needsPlan, periodMonthOf } from '@expanses/core';
import { leftWords as cardLeft, type NeedCard, needCards } from './budget-v1-model';
import { BudgetError, type BudgetRow, saveBudgets } from '@expanses/db';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Heart, House, LayoutList, type LucideIcon, Plus, Shield } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useEssentialSplit, useResolvedNeeds } from '../essential-split/queries';
import { SPLIT_LABELS, type SplitKey } from '../essential-split/split-view';
import { bareFigure } from '../networth/debt-rows';
import { countsAs as countsAsOf } from '../transactions/cashflow-desk-model';
import { useBooks, useMonthStart, useOpenBook } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { GoalsBox, LookBox, MonthBudgetBox, MonthSoFarBox, SplitBox, TakeHomeBox } from './BudgetBoxes';
import { cellText, type DeskRow, type DeskView, deskTable, gaugeOf, needsALook, planCell, shownRows } from './budget-desk-model';
import { daysLeft, findLine } from './budget-view';
import { TakeHomeSheet } from './BudgetSheets';
import { CapSheet } from './CapSheet';
import { CategoryPeek, TONE_COLOUR } from './CategoryPeek';
import { useBudgets, useBudgetSheet, useCommittedBills, useSpendingHistory } from './queries';
import { dependantsOf, shareBaseOf } from './share-form';
import { macV2 } from '../../ui/mac-detail';
import { DeskMonthPill } from '../bills/DeskMonthPill';
import { budgetTiles } from './budget-tiles';
import { CARD, CARD_HEAD, CARD_NOTE, DeskBar, DeskTitle, type IconColour, PILL, PILL_BLUE, Seg, StatTile, TileRow, tileMoney, Track } from '../../ui/desk';
import { PEEK_ROOM } from '../../ui/native/panel-frame';

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

const SEGMENTS: { value: DeskView; label: string }[] = [
  { value: 'spending', label: 'Spending' },
  { value: 'plan', label: 'Plan' },
];

/** The three tiles' marks (v1): a blue house, a pink heart, a green shield, each tag in its own colour. */
const TILE_LOOK: Record<SplitKey, { icon: LucideIcon; colour: IconColour; tag: 'blue' | 'pink' | 'green' }> = {
  essential: { icon: House, colour: 'blue', tag: 'blue' },
  lifestyle: { icon: Heart, colour: 'pink', tag: 'pink' },
  debtsSavings: { icon: Shield, colour: 'green', tag: 'green' },
};

/** A tile's tag. The kit's `Tag` has no pink, so the Lifestyle tag is drawn here on v1's pink pastel. */
function TileTag({ look, children }: { look: 'blue' | 'pink' | 'green' | 'red'; children: ReactNode }) {
  const colours = look === 'pink' ? { background: 'var(--mk-p-pink)', color: 'var(--mk-c-pink)' } : { background: `var(--mk-t-${look}-bg)`, color: `var(--mk-t-${look})` };
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-[9px] py-[1px] text-[11.5px] leading-[17px] font-bold whitespace-nowrap tabular-nums" style={colours}>
      {children}
    </span>
  );
}

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

/** Left as v1 reads it: "1.200.000", or "110.000 over" once past the budget (red where it is drawn). */
const leftWords = (minor: number, currency: string) => (minor < 0 ? `${bareFigure(-minor, currency)} over` : bareFigure(minor, currency));

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
  // The three tiles: the phone's Essential · Lifestyle · Debts & savings box (`needsPlan`), over the budget's own month.
  const split = useEssentialSplit(monthPeriod(month, monthStart)).data;
  const splitCurrency = split?.currency ?? currency;
  const tiles = sheet && split && needs ? budgetTiles(needsPlan(split.split, capsByNeed(sheet.lines, needs), sheet.incomePlanMinor), splitCurrency) : null;

  const table = sheet ? deskTable(sheet.lines, budgets ?? []) : null;
  const [folded, setFolded] = useState<Set<string>>(readFolds);
  const rows = table ? shownRows(table.rows, folded) : [];
  const days = daysLeft(month, today, monthStart);
  const daysNote = days === null ? null : days === 1 ? '1 day left' : `${days} days left`;
  const thisMonth = month === periodMonthOf(today, monthStart);
  // v1's line under the title: the month, the Total budgeted row's Spent of its Budget, and the days left.
  const totals = table ? gaugeOf(table) : null;
  const titleLine = [monthLabel(month), totals && totals.budgetedMinor > 0 ? `${tileMoney(totals.spentMinor, currency)} spent of ${tileMoney(totals.budgetedMinor, currency)} planned` : null, thisMonth ? daysNote : null]
    .filter(Boolean)
    .join(' · ');
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
  const look = table ? needsALook(table) : [];
  const peekStored = peekLine ? storedOf(peekLine.id) : undefined;
  const peekParent = peekLine && sheet ? parentNameOf(sheet.lines, peekLine.id) : null;
  const compact = peekLine !== undefined;
  const columns = compact ? 4 : 6;

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="budget-page" data-desk="true">
      <DeskBar crumb="Budget" barRef={bar}>
        {/* Spending / Plan and its typing table are v2's (option B, owner 2026-11-23): v1 plans in the Edit plan panel. */}
        {macV2 && <Seg label="Budget view" options={SEGMENTS} value={tab} onChange={setTab} />}
        <DeskMonthPill label={monthLabel(month)} onStep={(by) => setMonth(addMonths(month, by))} testId="budget-month" />
        <button type="button" onClick={editBudgets} title="Edit budgets" className={PILL}>
          Edit plan
        </button>
        <Link to="/transactions/new" aria-label="Add transaction" className={PILL_BLUE}>
          <Plus size={13} strokeWidth={2.6} aria-hidden /> Add
        </Link>
      </DeskBar>
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />
      <DeskTitle title="Budget" line={titleLine} />

      {/*
       * While the peek is open the whole page makes room for it, tiles and table alike, so it covers no figure; the boxes
       * go by the room they have (a container query, not the window's width), so they wrap rather than squeeze.
       */}
      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peekLine && PEEK_ROOM)}>
        <ErrorBox error={sheetQuery.error} />
        <Unconverted missing={sheet?.unconverted ?? []} currency={currency} />
        {tiles && (
          <div className="[&>div]:mb-0">
            <TileRow count={3} testId="budget-tiles">
              {tiles.map((tile) => (
                <StatTile
                  key={tile.key}
                  testId={`tile-${tile.key}`}
                  valueTestId={`tile-${tile.key}-used`}
                  icon={TILE_LOOK[tile.key].icon}
                  colour={TILE_LOOK[tile.key].colour}
                  value={tileMoney(tile.usedMinor, splitCurrency)}
                  label={tile.plannedMinor === null ? SPLIT_LABELS[tile.key] : `${SPLIT_LABELS[tile.key]} · of ${tileMoney(tile.plannedMinor, splitCurrency)}`}
                  badge={tile.tag && <TileTag look={tile.tag.tone === 'over' ? 'red' : TILE_LOOK[tile.key].tag}>{tile.tag.text}</TileTag>}
                />
              ))}
            </TileRow>
          </div>
        )}
        {/* v2 brings back the month's gauge, the split bar and Needs a look; Plan's own boxes are drawn either way. */}
        {sheet && table && !macV2 && needs && <NeedCards cards={needCards(table.rows, needs)} currency={currency} accounts={accounts} onOpen={setPeekId} onPlan={editBudgets} />}
        {sheet && table && macV2 && (
          <div className="grid grid-cols-1 items-stretch gap-[16px] @min-[478px]:grid-cols-2 @min-[478px]:[&>:first-child]:col-span-2 @min-[990px]:grid-cols-[1.45fr_1fr_0.95fr] @min-[990px]:[&>:first-child]:col-span-1">
            {tab === 'spending' ? (
              <>
                <MonthBudgetBox title={thisMonth ? 'This month’s budget' : `${monthLabel(month)} budget`} gauge={gaugeOf(table)} currency={currency} month={month} today={today} monthStart={monthStart} daysNote={daysNote} />
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

        {sheet && table && macV2 && (
          <section className={cx(CARD, 'overflow-hidden [contain:inline-size]')} aria-label="Categories">
            <h2 className={CARD_HEAD}>
              <LayoutList size={17} strokeWidth={1.9} aria-hidden className="shrink-0" />
              <span className="shrink-0">Categories</span>
              <span className={CARD_NOTE} title="Type a budget into its cell (an amount, or a % of its parent) · Tab moves down · ↑↓ step · ▼ folds a group">
                Type a budget into its cell (an amount, or a % of its parent) · Tab moves down · ▼ folds a group
              </span>
            </h2>
            <div className="overflow-x-auto px-[10px] pb-[10px]">
              {/* With the peek open the table makes room for it: Counts as (the peek says it) and the bar step aside. */}
              <table className={cx('w-full table-fixed border-collapse text-[13.5px]', compact ? 'min-w-[540px]' : 'min-w-[820px]')}>
                <colgroup>
                  <col />
                  {tab === 'plan' && <col className="w-[150px]" />}
                  {!compact && <col className="w-[120px]" />}
                  {tab === 'spending' && <col className="w-[150px]" />}
                  <col className="w-[120px]" />
                  <col className="w-[140px]" />
                  {!compact && <col className="w-[170px]" />}
                </colgroup>
                <thead>
                  <tr className="text-[12.5px] font-semibold text-[var(--mk-ink-2)]">
                    <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-left font-semibold">Category</th>
                    {tab === 'plan' && <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-right font-semibold">Budget</th>}
                    {!compact && <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-left font-semibold">Counts as</th>}
                    {tab === 'spending' && <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-right font-semibold">Budget</th>}
                    <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-right font-semibold">Spent</th>
                    <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px] text-right font-semibold">Left</th>
                    {!compact && (
                      <th className="border-b border-[var(--mk-head-line)] px-[10px] py-[8px]">
                        <span className="sr-only">Used</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.length === 0 && (
                    <tr>
                      <td colSpan={columns} className="px-3 py-6 text-center text-[13.5px] text-[var(--mk-ink-2)]">
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
                          <td colSpan={columns} className="border-t border-[var(--mk-line)] px-[10px] pt-[14px] pb-[5px] text-[11.5px] font-bold tracking-[0.04em] text-[var(--mk-ink-2)] uppercase">
                            No budget yet
                          </td>
                        </tr>
                      ) : null,
                      <BudgetTableRow
                        key={row.key}
                        row={row}
                        tab={tab}
                        compact={compact}
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
                    <tr data-testid="budget-total" className="border-t border-[var(--mk-head-line)] font-bold text-[var(--mk-ink)]">
                      <td className="px-[10px] py-[9px]">Total budgeted</td>
                      {tab === 'plan' && <td data-testid="total-budget" className="px-[10px] py-[9px] text-right tabular-nums">{bareFigure(table.total.budgetMinor, currency)}</td>}
                      {!compact && <td />}
                      {tab === 'spending' && <td data-testid="total-budget" className="px-[10px] py-[9px] text-right tabular-nums">{bareFigure(table.total.budgetMinor, currency)}</td>}
                      <td data-testid="total-spent" className="px-[10px] py-[9px] text-right tabular-nums">{bareFigure(table.total.spentMinor, currency)}</td>
                      <td data-testid="total-left" className={cx('px-[10px] py-[9px] text-right tabular-nums', table.total.leftMinor < 0 && 'text-[var(--mk-t-red)]')}>
                        {leftWords(table.total.leftMinor, currency)}
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

/**
 * Budget v1 (option B): a card for each of Essential, Lifestyle and Debts & savings, a row per budgeted category with
 * what it spent of its budget and what is left or over. A row opens the category's peek; the budgets are typed in Edit
 * plan, which a part with nothing budgeted points to.
 */
function NeedCards({
  cards,
  currency,
  accounts,
  onOpen,
  onPlan,
}: {
  cards: NeedCard[];
  currency: string;
  accounts: Parameters<typeof CategoryIcon>[0]['accounts'];
  onOpen: (categoryId: string) => void;
  onPlan: () => void;
}) {
  const money = (minor: number) => formatMinor(minor, currency);
  if (cards.length === 0) {
    return (
      <section className={cx(CARD, 'px-[20px] py-[18px] text-[14px] text-[var(--mk-ink-2)]')} data-testid="budget-cards-empty">
        Nothing is budgeted this month.{' '}
        <button type="button" onClick={onPlan} className="font-semibold text-[var(--mk-blue)] hover:underline">
          Edit plan
        </button>
      </section>
    );
  }
  return (
    <div className="grid grid-cols-1 items-start gap-[16px] @min-[700px]:grid-cols-3" data-testid="budget-cards">
      {cards.map((card) => (
        <section key={card.need} className={cx(CARD, 'min-w-0 px-[20px] pt-[16px] pb-[10px]')} aria-label={card.title} data-testid={`budget-card-${card.need}`}>
          <h2 className="mb-[6px] flex items-center gap-[9px] text-[15.5px] font-bold text-[var(--mk-ink-2)]">
            <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: NEED_DOT[card.need] }} />
            <span className="min-w-0 flex-1 truncate">{card.title}</span>
            <span className="shrink-0 text-[12.5px] font-semibold">{card.rows.length === 1 ? '1 category' : `${card.rows.length} categories`}</span>
          </h2>
          {card.rows.map((row) => {
            const left = cardLeft(row.leftMinor ?? 0, money);
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onOpen(row.categoryId)}
                data-testid={`budget-card-row-${row.label}`}
                className="block w-full border-t border-[var(--mk-line)] py-[10px] text-left first-of-type:border-t-0"
              >
                <span className="mb-[8px] flex items-center gap-[10px]">
                  <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--mk-ink)]">{row.label}</span>
                  <span data-testid="budget-card-left" className={cx('shrink-0 text-[13.5px] font-semibold tabular-nums', left.over ? 'text-[var(--mk-c-red)]' : 'text-[var(--mk-ink)]')}>
                    {left.text}
                  </span>
                </span>
                <Track share={row.share} colour={left.over ? 'var(--mk-c-red)' : NEED_DOT[card.need]} />
                <span data-testid="budget-card-of" className="mt-[6px] block truncate text-[12px] text-[var(--mk-ink-2)] tabular-nums">
                  {money(row.spentMinor)} of {money(row.budgetMinor ?? 0)}
                  {row.percent ? ` · ${row.percent}` : ''}
                </span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

const NEED_DOT: Record<NeedCard['need'], string> = { essential: 'var(--mk-c-blue)', lifestyle: 'var(--mk-c-pink)', debts_savings: 'var(--mk-c-green)' };

/** One row of the Categories table: a group with its fold, or a category whose Budget cell is typed into in place. */
function BudgetTableRow({
  row,
  tab,
  compact,
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
  const cell = 'border-t border-[var(--mk-line)] px-[10px] py-[7px] whitespace-nowrap';
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
          className="-my-[2px] h-[24px] w-full rounded-[7px] bg-[var(--mk-field)] px-[7px] text-right text-[13.5px] text-[var(--mk-ink)] tabular-nums outline-2 outline-[var(--mk-blue)] placeholder:text-[var(--mk-ink-3)]"
        />
        {error && (
          <span role="alert" className="absolute right-[10px] z-10 mt-[3px] max-w-[260px] rounded-[8px] bg-[var(--mk-c-red)] px-[8px] py-[3px] text-left text-[11.5px] whitespace-normal text-white shadow">
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
        className="-my-[2px] w-full rounded-[7px] px-[4px] py-[2px] text-right tabular-nums hover:bg-[var(--mk-pill)] focus-visible:outline-2 focus-visible:outline-[var(--mk-blue)]"
      >
        {row.budgetMinor === null ? (
          <span className="text-[var(--mk-ink-3)]">Set…</span>
        ) : (
          <>
            {(row.percent || row.frequency !== 'monthly' || row.overridden) && (
              <span className="text-[12px] text-[var(--mk-ink-2)]">{row.overridden ? 'this month' : row.percent ?? row.frequency} · </span>
            )}
            <span className="text-[var(--mk-blue)]">{bareFigure(row.budgetMinor, currency)}</span>
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
      className={cx('text-[var(--mk-ink)]', peeked && !group && 'bg-[var(--mk-sel)]')}
    >
      <td className={cx(cell, 'overflow-hidden')} style={{ paddingLeft: 10 + row.depth * 24 }}>
        <span className="flex min-w-0 items-center gap-[6px]">
          {group ? (
            <button
              type="button"
              aria-expanded={!folded}
              aria-label={folded ? `Unfold ${row.label}` : `Fold ${row.label}`}
              onClick={onFold}
              className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-[10px] text-[var(--mk-ink-2)] hover:text-[var(--mk-ink)]"
            >
              {folded ? '▶' : '▼'}
            </button>
          ) : (
            <span aria-hidden className="w-[16px] shrink-0" />
          )}
          <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="sm" />
          <button type="button" onClick={onPeek} title={`See ${row.name}’s transactions`} className={cx('min-w-0 truncate text-left hover:underline', named)}>
            {row.label}
          </button>
        </span>
      </td>
      {tab === 'plan' && budgetCell}
      {!compact && <td className={cx(cell, 'text-[var(--mk-ink-2)]')}>{counts}</td>}
      {tab === 'spending' && budgetCell}
      <td data-testid="spent-cell" className={cx(cell, 'text-right tabular-nums', strong)}>
        {bareFigure(row.spentMinor, currency)}
      </td>
      <td data-testid="left-cell" className={cx(cell, 'text-right tabular-nums', strong, row.leftMinor !== null && row.leftMinor < 0 && 'font-semibold text-[var(--mk-t-red)]')}>
        {row.leftMinor === null ? <span className="text-[var(--mk-ink-3)]">—</span> : leftWords(row.leftMinor, currency)}
      </td>
      {!compact && (
      <td className={cell}>
        {row.tone && <Track share={Math.min(1, row.share)} colour={TONE_COLOUR[row.tone]} />}
      </td>
      )}
    </tr>
  );
}

