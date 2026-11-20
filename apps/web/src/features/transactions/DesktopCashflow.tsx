import { DeskNotices } from '../../app/DeskNotices';
import { categoryTree, formatMinor, isUncategorisedKey, monthName, parseLooseDate, parsePeriod, periodLabel, periodMonthOf, stepPeriod } from '@expanses/core';
import { type AccountRow, categoryTotalsIn, type DraftRow, firstTransactionDate } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight, Plus, Repeat, Search, X } from 'lucide-react';
import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInOpenBook } from '../../lib/queries';
import { cx } from '../../ui';
import { CategoryIcon, useCategoryMarkColour } from '../categories/CategoryIcon';
import { useCategorySetMembership, useCategorySets } from '../categories/set-queries';
import { useMonthStart, useOpenBook } from '../workspaces/queries';
import { BOX, DailyBox, MonthBox, NOTE, RingBox } from './CashflowBoxes';
import { clickAction, deskAmount, monthFigures, orderNote, pageShortcut, peekKey, recordable, recordedToast, ringLegend, type Selection, type SelectionAction, skippedLine, waitingOrder, waitingSpan } from './cashflow-desk-model';
import { type BulkActions, type RecordMany, SelectionPeek } from './CashflowPeek';
import type { ChipOption } from './ChipMenu';
import { categoryButtonLabel, type ListFilters, type ListRow, type Sort } from './list-model';
import { PeriodPicker, yearsSince } from './PeriodPicker';
import { DESK_COLUMNS, DESK_GRID, PICKED_CELL, type RowOptions } from './QuickRowEditor';
import type { CellColumn } from './cell-range';
import { useCashflowCells } from './cashflow-cells';
import { forgetMark, guessHint, keepMarks, learnFromSaved, paidHint, readMarks, unknownLinks, unknownLinksLine } from './paste-categories';
import { quickFromDraft, type QuickValues, shortDate } from './quick-row';
import { UndoToast } from '../../ui/UndoToast';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { ReceiptPeek } from './ReceiptPeek';
import { useSpendingTrend } from './SpendingTrend';
import { NOT_MONTHLY_LABEL, notMonthlyWord } from './not-monthly';
import { EditableRow, type TableHandlers, TypingRow } from './TransactionsTable';

type Filters = Omit<ListFilters, 'month'>;

/**
 * A side of the ledger by category over the period, read exactly as the phone's ring reads it (`SpendingReport`): the
 * same query, so the two share one read, the same tree of the open book's categories, a category set as one slice. Over a
 * period shorter than a year, not-monthly bills are left out as the phone's ring leaves them (`leaveOutNotMonthly`, the
 * same key).
 */
function useRing(kind: 'expense' | 'income', month: string, paidAccountId: string | undefined, leaveOutNotMonthly: boolean) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const inOpenBook = useInOpenBook();
  const monthStart = useMonthStart();
  const period = parsePeriod(month, monthStart);
  const from = period?.from ?? '0000-01-01';
  const to = period?.to ?? '9999-12-31';
  const eventsInCaps = useOpenBook()?.countEventsInBudget ?? false;
  const totals = useQuery({
    queryKey: ['category-totals', ws.workspaceId, ws.bookId ?? null, kind, month, monthStart, eventsInCaps ? 'with-events' : 'without-events', paidAccountId ?? null, leaveOutNotMonthly ? 'not-monthly-out' : 'not-monthly-in'],
    queryFn: () => categoryTotalsIn(database, ws, kind, from, to, { excludeEvents: !eventsInCaps, billMonths: true, paidAccountId, leaveOutNotMonthly }),
  });
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets().data ?? [];
  const ofKind = accounts.filter((a) => a.kind === kind);
  const amounts = (totals.data?.rows ?? []).map((row) => ({ accountId: row.accountId, amountBaseMinor: row.amountBaseMinor }));
  const tree = categoryTree(
    ofKind.filter((a) => membership[a.id] === undefined && inOpenBook(a)),
    amounts,
  );
  const setsMinor = sets.reduce((sum, set) => sum + categoryTree(ofKind.filter((a) => membership[a.id] === set.id), amounts).reduce((s, node) => s + node.totalMinor, 0), 0);
  const totalMinor = tree.reduce((sum, node) => sum + node.totalMinor, 0) + setsMinor;
  return { tree, setsMinor, totalMinor, currency: totals.data?.currency ?? ws.baseCurrency, ready: totals.isSuccess, eventsInCaps };
}

const SEGMENTS: { value: Filters['type']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Spending' },
  { value: 'income', label: 'Income' },
];

const GBTN = 'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';

/** One list of the Filter menu: a choice per line, the picked one ticked. */
function MenuList({ title, options, value, onPick }: { title: string; options: readonly ChipOption[]; value: string; onPick: (value: string) => void }) {
  return (
    <div role="group" aria-label={title}>
      <p className="px-2 pt-2 pb-1 text-[11px] font-semibold text-[var(--ph-ink-3)]">{title}</p>
      <ul className="max-h-[168px] overflow-y-auto">
        {options.length === 0 && <li className="px-2 py-1 text-[12px] text-[var(--ph-ink-3)]">Nothing matches.</li>}
        {options.map((option) => (
          <li key={option.value || 'any'}>
            <button
              type="button"
              aria-pressed={option.value === value}
              onClick={() => onPick(option.value)}
              className={cx('flex w-full items-center gap-2 rounded-[6px] px-2 py-[4px] text-left text-[12.5px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]', option.indent && 'pl-6')}
            >
              <span aria-hidden className="w-3 text-[11px]">
                {option.value === value ? '✓' : ''}
              </span>
              {option.icon}
              <span className="min-w-0 truncate">{option.label}</span>
              {option.meta && <span className="ml-auto text-[11px] whitespace-nowrap text-[var(--ph-ink-3)] tabular-nums">{option.meta}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Not-monthly bills over the period on show (the phone's ⋯ Not monthly, `leavesOutNotMonthly`): what the page's figures do with them. */
export interface DeskNotMonthly {
  /** The ring, the boxes and the day bars leave them out: less than a year, with Not monthly on Hidden. */
  out: boolean;
  /** Not monthly Shown, as this device keeps it. */
  shown: boolean;
  /** A year or longer always counts them: the Filter offers no row for them. */
  yearOrLonger: boolean;
  onShown: (shown: boolean) => void;
  /** "1 not in the ring", while some are left out. */
  note: string | null;
}

/**
 * Filter ⌄: today's filters in one menu — the category (with everything under it), what paid, rows deleted, rows not
 * recorded yet and what still waits for a category — Not monthly (a grey word, Hidden or Shown), and Clear. Esc or a click outside closes it.
 */
function FilterMenu({
  filters,
  setFilter,
  categoryOptions,
  paidOptions,
  pendingCount,
  needsCategory,
  notMonthly,
  narrowed,
  onClearAll,
  open,
  setOpen,
}: {
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  categoryOptions: readonly ChipOption[];
  paidOptions: readonly ChipOption[];
  pendingCount: number;
  needsCategory: { count: number; active: boolean; onShow: () => void; onClear: () => void };
  notMonthly: DeskNotMonthly;
  narrowed: boolean;
  onClearAll: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, setOpen]);
  // Not monthly Shown counts as one where it is offered, as the phone's ⋯ counts it.
  const shownOffered = notMonthly.shown && !notMonthly.yearOrLonger;
  const on = [filters.cat, filters.paid, filters.showDeleted, filters.onlyDrafts, filters.needsCategory, shownOffered].filter(Boolean).length;
  const words = query.trim().toLowerCase();
  const match = (option: ChipOption) => !words || `${option.label} ${option.meta ?? ''} ${option.keywords ?? ''}`.toLowerCase().includes(words);
  const check = 'flex items-center gap-2 rounded-[6px] px-2 py-[4px] text-[12.5px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className={cx(GBTN, on > 0 && 'border-[var(--ph-ink)]')}>
        Filter{on > 0 ? ` · ${on}` : ''}
        <ChevronDown size={13} aria-hidden className="text-[var(--ph-ink-3)]" />
      </button>
      {open && (
        <div role="dialog" aria-label="Filter" className="absolute right-0 z-30 mt-1 w-[300px] rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-1 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a category or account"
            aria-label="Find a category or account"
            className="mb-1 h-[26px] w-full rounded-[6px] bg-[var(--ph-fill)] px-2 text-[12.5px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
          />
          <MenuList title="Category" options={categoryOptions.filter((option) => !option.value || match(option))} value={filters.cat} onPick={(value) => setFilter('cat', value)} />
          <MenuList title="Paid with" options={paidOptions.filter((option) => !option.value || match(option))} value={filters.paid} onPick={(value) => setFilter('paid', value)} />
          <div className="mt-1 border-t border-[var(--ph-hair)] pt-1">
            <label className={check}>
              <input type="checkbox" checked={filters.showDeleted} onChange={(event) => setFilter('showDeleted', event.target.checked)} />
              Show deleted
            </label>
            {(pendingCount > 0 || filters.onlyDrafts) && (
              <label className={check}>
                <input type="checkbox" checked={filters.onlyDrafts} onChange={(event) => setFilter('onlyDrafts', event.target.checked)} />
                Only not recorded ({pendingCount})
              </label>
            )}
            {(needsCategory.count > 0 || needsCategory.active) && (
              <label className={check}>
                <input type="checkbox" checked={needsCategory.active} onChange={(event) => (event.target.checked ? needsCategory.onShow() : needsCategory.onClear())} />
                Waiting for a category ({needsCategory.count})
              </label>
            )}
            {/* Not monthly (owner, 2026-11-18): Hidden, less than a year lists those bills greyed and leaves them out of its
                figures; a click shows the other word, the menu left open, as the phone's Sort cycles. A year counts them, and
                offers no row. */}
            {!notMonthly.yearOrLonger && (
              <button
                type="button"
                aria-label={`Not monthly, ${notMonthlyWord(notMonthly.shown)}`}
                data-testid="not-monthly-cycle"
                onClick={() => notMonthly.onShown(!notMonthly.shown)}
                className={cx(check, 'w-full justify-between text-left')}
              >
                <span>Not monthly</span>
                <span className="text-[var(--ph-ink-3)]">{notMonthlyWord(notMonthly.shown)}</span>
              </button>
            )}
            {(narrowed || shownOffered) && (
              <button
                type="button"
                onClick={() => {
                  onClearAll();
                  notMonthly.onShown(false);
                }}
                className={cx(check, 'w-full text-left text-[var(--ph-ink-3)]')}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Things the page works out about a row that the table and the peek both show. */
export interface DeskRowHelpers {
  /** What paid: the payer's line in a shared workspace, else the account and its digits. */
  paidWith: (row: ListRow) => ReactNode;
  /** Whether the row opens in the full edit screen from here: the same refusals the list's click had. */
  editable: (row: ListRow) => boolean;
  /** An instalment month's row opens its plan instead of a peek. */
  openInstalment: (row: ListRow) => void;
  /** The label of a row that is not spending or income (a loan with a fee, say): "Lend & borrow". */
  kindLabel: (row: ListRow) => string | null;
  /** The category gesture (spec §9): its icon re-files the row at once, with Undo — when the row offers it. */
  refile: (row: ListRow) => (() => void) | null;
}

const peekable = (row: ListRow) => row.kind === 'tx' && !row.instalment && !row.sharedTransfer && !!row.tx;

const longDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * Cashflow on a wide screen (Mac Cashflow D, owner-picked 2026-11-17): a title bar with the period, filters, search,
 * Scan receipt and ＋ Add; three boxes in the Overview's style; and the typing table across the full width, whose rows
 * open a side peek on a click and the full edit screen on a double-click or Return. The phone's Cashflow is not this
 * page — `TransactionsPage` draws it as before and hands this one what it has already worked out.
 */
export function DesktopCashflow({
  month,
  thisMonth,
  onMonth,
  filters,
  setFilter,
  narrowed,
  onClearAll,
  sort,
  onSort,
  kind,
  paidAccountId,
  rows,
  emptyText,
  limitNote,
  pendingCount,
  reviewCount,
  drafts,
  waiting: waitingIn,
  accounts,
  rowOptions,
  handlers,
  today,
  baseCurrency,
  categoryOptions,
  paidOptions,
  readOnly,
  scan,
  onAdd,
  onEdit,
  chips,
  needsCategory,
  notMonthly,
  helpers,
  selection,
  onSelection,
  bulk,
  notices,
  children,
}: {
  month: string;
  thisMonth: string;
  onMonth: (next: string) => void;
  filters: Filters;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  narrowed: boolean;
  onClearAll: () => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  kind: 'expense' | 'income';
  paidAccountId?: string;
  /** The table's rows, filtered and sorted as the page reads them. */
  rows: readonly ListRow[];
  emptyText: string;
  limitNote?: string;
  pendingCount: number;
  /** Of those, Review's (captures and imports, `inReviewQueue`): the This month box's To review. */
  reviewCount: number;
  /** Every row waiting as not recorded: where a paste's rows are found again, whatever the table is narrowed to. */
  drafts: readonly DraftRow[];
  /**
   * The rows typed or pasted here to finish later (manual drafts), whatever month they are dated in: just above the
   * typing row, in the order they came in, each with its Record and ✕ (option E). Not among `rows`.
   */
  waiting: readonly ListRow[];
  accounts: readonly AccountRow[];
  rowOptions: RowOptions;
  handlers: TableHandlers;
  today: string;
  baseCurrency: string;
  categoryOptions: readonly ChipOption[];
  paidOptions: readonly ChipOption[];
  readOnly: boolean;
  scan: { busy: boolean; scan: () => void };
  onAdd: () => void;
  onEdit: (row: ListRow) => void;
  /** What narrows the page beyond the filters: the account or category it was opened for, Essential or Lifestyle. */
  chips: { key: string; label: ReactNode; clearLabel: string; onClear: () => void }[];
  needsCategory: { count: number; active: boolean; onShow: () => void; onClear: () => void };
  /** Not-monthly bills over this period: left out of the ring, the boxes and the bars under a year, and the Filter's row. */
  notMonthly: DeskNotMonthly;
  helpers: DeskRowHelpers;
  /** The rows picked (`selectionReducer`): the page keeps them, since its bulk actions act on them. */
  selection: Selection;
  onSelection: (action: SelectionAction) => void;
  /** Several rows picked: what they add up to (formatted) and the list's bulk actions. */
  bulk: BulkActions & { spent: string | null; received: string | null };
  notices?: ReactNode;
  /** The page's sheets: Add, the set-aside question. */
  children?: ReactNode;
}) {
  const { database, ws } = useApp();
  const colourFor = useCategoryMarkColour();
  // Under a year the ring, Spent / Received / Left and the day bars leave not-monthly bills out, as the phone's do.
  const ring = useRing(kind, month, paidAccountId, notMonthly.out);
  const spent = useRing('expense', month, paidAccountId, notMonthly.out);
  const received = useRing('income', month, paidAccountId, notMonthly.out);
  const trend = useSpendingTrend(month, kind, !ring.eventsInCaps, notMonthly.out);
  const legend = ringLegend(ring.tree, colourFor, ring.setsMinor);
  const figures = monthFigures(spent.ready ? spent.totalMinor : null, received.ready ? received.totalMinor : null, reviewCount);
  const monthStart = useMonthStart();
  const period = parsePeriod(month, monthStart);
  const [picking, setPicking] = useState(false);
  const first = useQuery({ queryKey: ['first-transaction', ws.workspaceId], queryFn: () => firstTransactionDate(database, ws), enabled: picking });
  const [filtering, setFiltering] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  // The peek hangs from the title bar's foot, wherever a notice above the page has pushed it, and follows a scroll.
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);

  // The waiting rows in the order they came in; a paste heard here keeps its own order among rows made in one moment.
  const [pasteOrder, setPasteOrder] = useState<string[]>([]);
  const waiting = waitingOrder(waitingIn, pasteOrder);
  // The rows picked, in the table's own order: one shows its side peek, several what can be done to them all at once.
  // A waiting row is picked too (⌘-click; ⇧-click from the last row clicked, picked or typed in; ⌘A), for Record N; it
  // has no peek of its own.
  const dispatch = onSelection;
  const peekIds = rows.filter(peekable).map((row) => row.id);
  const ids = [...peekIds, ...waiting.map((row) => row.id)];
  const idsKey = ids.join(',');
  useEffect(() => dispatch({ type: 'listed', ids }), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = new Set(selection.ids);
  const one = selection.ids.length === 1 ? selection.ids[0]! : null;
  const selected = one ? rows.find((row) => row.id === one && peekable(row)) : undefined;
  const many = selection.ids.length > 1;
  useEffect(() => {
    if (!one) return;
    document.querySelector(`[data-row-id="${CSS.escape(one)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [one]);
  const peeking = selected !== undefined || many;
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

  // A row this page may not change (a trade, another workspace's, a share that ended) has no edit screen: its peek, read
  // only, is all there is of it here.
  const edit = (row: ListRow) => {
    if (helpers.editable(row)) onEdit(row);
  };
  // A row's first click opens the peek, and the page making room for it can move the row from under the pointer: the
  // second click, at the same place and soon enough, is still the row's double-click (`usePeekDoubleClick`) — its edit
  // screen, never whatever box or row now sits there.
  const doubleClick = usePeekDoubleClick((id) => {
    const row = rows.find((one) => one.id === id);
    if (row && peekable(row)) edit(row);
  });
  // Keys for the whole page: ⌘N, ⌘F and ⌘A, and — while rows are picked — Esc, and with one ↑ ↓ and Return.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    const covered = filtering || picking || document.querySelector('[role="dialog"]') !== null;
    const shortcut = covered ? null : pageShortcut(event);
    if (shortcut === 'new' && !readOnly) {
      event.preventDefault();
      onAdd();
      return;
    }
    if (shortcut === 'search') {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
      return;
    }
    // ⌘A in a field selects its text, as everywhere; on the table it picks every row listed.
    if (shortcut === 'all' && !typing) {
      event.preventDefault();
      if (ids.length > 0) dispatch({ type: 'all', ids });
      return;
    }
    const action = peekKey(event.key, { count: selected ? 1 : selection.ids.length, typing, covered });
    if (!action) return;
    // Return on a button or a link (the peek's Delete, say) is that control's own press, never the edit screen.
    if (action === 'edit' && target?.closest('button, a')) return;
    event.preventDefault();
    if (action === 'close') dispatch({ type: 'close' });
    else if (action === 'up' || action === 'down') dispatch({ type: 'step', by: action === 'up' ? -1 : 1, ids: peekIds });
    else if (selected) edit(selected);
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  const icon = (categoryId: string) => <CategoryIcon categoryId={categoryId} accounts={accounts} size="xs" />;
  // What this device keeps of pasted rows (`paste-categories`): a guessed category's mark, an unmatched name to learn.
  const [marks, setMarks] = useState(readMarks);
  // Rows recorded from the waiting rows: the toast says which month they went to, with Show › and Undo (option E), and
  // how many Record N or Record all left waiting.
  const [recorded, setRecorded] = useState<{ items: { draftId: string; transactionId: string; month: string }[]; skipped: number } | null>(null);
  // While Record N or Record all runs, each row recorded joins one toast rather than showing its own.
  const batch = useRef<{ draftId: string; transactionId: string; month: string }[] | null>(null);
  const [recordingMany, setRecordingMany] = useState(false);
  const monthOf = (values: QuickValues) => {
    const iso = parseLooseDate(values.date, today);
    return iso ? periodMonthOf(iso, monthStart) : null;
  };
  const deskHandlers: TableHandlers = {
    ...handlers,
    keepPasted: async (values, made) => {
      // The marks are kept as soon as the drafts exist, before their rows show: a row recorded at once still teaches.
      const keep = (ids: string[]) => {
        const byId = Object.fromEntries(ids.map((id, i) => [id, made?.[i] ?? {}]));
        setMarks(keepMarks(byId, new Set([...drafts.map((draft) => draft.id), ...ids])));
        setPasteOrder((was) => [...was, ...ids]);
      };
      return handlers.keepPasted(values, made, keep);
    },
    // A pasted row saved or recorded teaches its unmatched name or Notion link the value picked for it, and the other
    // waiting rows naming it fill in (`learnFromSaved`); one discarded is let go.
    // Taught as the save starts, so a paste straight after already knows it; a save that fails puts the marks back.
    // A row recorded goes to its own month: the toast says where (`recordedToast`).
    saveDraft: async (id, values, record, onRecorded) => {
      const mine = readMarks()[id];
      const waitingNow = drafts.filter((draft) => draft.id !== id && marks[draft.id]).map((draft) => ({ id: draft.id, values: quickFromDraft(draft, today, accounts) }));
      // A row with no category (recorded under Uncategorised) teaches its name or link nothing: Uncategorised is no answer.
      const filedNowhere = !values.categoryId || isUncategorisedKey(accounts.find((a) => a.id === values.categoryId)?.systemKey);
      const { fills } = learnFromSaved(id, filedNowhere ? { ...values, categoryId: '' } : values, record, waitingNow);
      const month = record ? monthOf(values) : null;
      const ok = await handlers.saveDraft(id, values, record, (transactionId) => {
        onRecorded?.(transactionId);
        if (!month) return;
        const item = { draftId: id, transactionId, month };
        if (batch.current) batch.current.push(item);
        else setRecorded({ items: [item], skipped: 0 });
      });
      // Read back from the device, not from before the save: a paste made meanwhile has marks of its own.
      const now = readMarks();
      setMarks(!ok && mine ? keepMarks({ [id]: mine }, new Set(Object.keys(now))) : now);
      if (!ok) return ok;
      for (const fill of fills) await handlers.saveDraft(fill.id, fill.values, false);
      return ok;
    },
    dismissDraft: async (id) => {
      const ok = await handlers.dismissDraft(id);
      if (ok) setMarks(forgetMark(id));
      return ok;
    },
  };
  // The blue cells: a range down one column, across recorded rows and the waiting rows under them (`cashflow-cells`).
  // Starting one lets the picked rows and their peek go, so the two selections never show at once.
  const tableRows = [...rows, ...waiting];
  const cells = useCashflowCells({ rows: tableRows, today, accounts, rowOptions, handlers, saveDraft: deskHandlers.saveDraft, readOnly, onStart: () => dispatch({ type: 'close' }) });
  const guessOf = (id: string) => {
    const mark = marks[id];
    const hint = guessHint(mark);
    return mark?.guessed && hint ? { categoryId: mark.guessed.categoryId, hint } : null;
  };
  const paidGuessOf = (id: string) => {
    const mark = marks[id];
    const hint = paidHint(mark);
    return mark?.paidGuessed && hint ? { key: mark.paidGuessed, hint } : null;
  };
  // Notion links among the waiting pasted rows this device does not know yet: a light grey count in the box header.
  const unknown = unknownLinks(marks, new Set(drafts.map((draft) => draft.id)));
  // Record N: the waiting rows picked that can be recorded, one after another, each as its own Record records it. Record
  // all: every waiting row that can. Only a date, amount or Paid with missing leaves a row waiting (`recordable`).
  const pickedWaiting = recordable(selection.ids, waiting, accounts, today, baseCurrency);
  const allWaiting = recordable(waiting.map((row) => row.id), waiting, accounts, today, baseCurrency);
  const waitingPicked = waiting.filter((row) => picked.has(row.id)).length;
  const recordMany = async (which: { ready: readonly ListRow[]; skipped: number }) => {
    setRecordingMany(true);
    batch.current = [];
    try {
      for (const row of which.ready) await deskHandlers.saveDraft(row.id, quickFromDraft(row.draft!, today, accounts), true);
    } finally {
      const items = batch.current ?? [];
      batch.current = null;
      setRecordingMany(false);
      if (items.length > 0) setRecorded({ items, skipped: which.skipped });
    }
  };
  // What the waiting rows picked add up to, in the workspace's money (a row read in another currency is left out).
  const waitingMinor = waiting.filter((row) => picked.has(row.id) && row.draft?.currency === baseCurrency).reduce((sum, row) => sum + Math.abs(row.draft!.amountMinor), 0);
  const recordMore: RecordMany | undefined =
    waitingPicked > 0 && !readOnly
      ? {
          count: waitingPicked,
          ready: pickedWaiting.ready.length,
          skipped: pickedWaiting.skipped > 0 ? skippedLine(pickedWaiting.skipped) : null,
          total: waitingMinor > 0 ? formatMinor(waitingMinor, baseCurrency) : null,
          span: waitingSpan(waiting.filter((row) => picked.has(row.id)).map((row) => row.draft?.occurredOn ?? '')),
          busy: recordingMany,
          onRecord: () => void recordMany(pickedWaiting),
        }
      : undefined;
  const toast = recorded ? recordedToast(recorded.items.map((item) => item.month), recorded.skipped) : null;
  const at = selected ? peekIds.indexOf(selected.id) : -1;
  const sortBy = (key: Sort['key']) => onSort({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' });
  const sortMark = (key: Sort['key']) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');
  const ariaSort = (key: Sort['key']) => (sort.key === key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none');
  const periodNote = period?.kind === 'month' ? monthName(month, 'long') : periodLabel(month);

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="desktop-cashflow" {...doubleClick}>
      <header ref={bar} className="desk-titlebar sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Cashflow</h1>
        {chips.map((chip) => (
          <span key={chip.key} className="inline-flex h-[22px] max-w-[220px] items-center gap-1 rounded-full bg-[var(--ph-fill)] pr-[2px] pl-[9px] text-[12px] text-[var(--ph-ink)]">
            <span className="min-w-0 truncate">{chip.label}</span>
            <button type="button" aria-label={chip.clearLabel} onClick={chip.onClear} className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[var(--ph-ink-3)] hover:bg-[var(--ph-hair)]">
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}
        <span className="flex-1" />
        <div role="group" aria-label="Show" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
          {SEGMENTS.map((segment) => (
            <button
              key={segment.value}
              type="button"
              aria-pressed={filters.type === segment.value}
              onClick={() => setFilter('type', segment.value)}
              className={cx(
                'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
                filters.type === segment.value ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
              )}
            >
              {segment.label}
            </button>
          ))}
        </div>
        <FilterMenu
          filters={filters}
          setFilter={setFilter}
          categoryOptions={categoryOptions}
          paidOptions={paidOptions}
          pendingCount={pendingCount}
          needsCategory={needsCategory}
          notMonthly={notMonthly}
          narrowed={narrowed}
          onClearAll={onClearAll}
          open={filtering}
          setOpen={setFiltering}
        />
        <div className="flex items-center gap-[2px] text-[13px] text-[var(--ph-ink)]">
          <button type="button" aria-label="Earlier period" disabled={!stepPeriod(month, -1)} onClick={() => onMonth(stepPeriod(month, -1)!)} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] disabled:opacity-30">
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button type="button" data-testid="chart-month" aria-label={`${periodLabel(month)}, choose a period`} onClick={() => setPicking(true)} className="rounded px-1 whitespace-nowrap tabular-nums hover:bg-[var(--ph-fill)]">
            {periodLabel(month)}
          </button>
          <button type="button" aria-label="Later period" disabled={!stepPeriod(month, 1)} onClick={() => onMonth(stepPeriod(month, 1)!)} className="flex h-[24px] w-[22px] items-center justify-center rounded text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] disabled:opacity-30">
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
        <label className="relative flex h-[26px] w-[150px] shrink-0 items-center rounded-[7px] bg-[var(--ph-fill)] text-[12px]">
          <Search size={13} aria-hidden className="pointer-events-none absolute left-[8px] text-[var(--ph-ink-3)]" />
          <input
            ref={search}
            type="search"
            value={filters.q}
            onChange={(event) => setFilter('q', event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && filters.q) {
                event.preventDefault();
                setFilter('q', '');
              }
            }}
            placeholder="Search"
            aria-label="Search transactions"
            title="Description, category, card digits or amount (⌘F)"
            autoComplete="off"
            className="h-full w-full rounded-[7px] bg-transparent pr-2 pl-[26px] text-[12px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-2 focus:outline-[var(--mac-accent)]"
          />
        </label>
        {!readOnly && (
          <button type="button" disabled={scan.busy} onClick={() => scan.scan()} className={cx(GBTN, 'disabled:opacity-50')}>
            {scan.busy ? 'Reading the receipt…' : 'Scan receipt'}
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            aria-label="Add transaction"
            title="New transaction (⌘N)"
            onClick={onAdd}
            className="flex h-[26px] items-center gap-1 rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]"
          >
            <Plus size={13} aria-hidden /> Add
          </button>
        )}
      </header>
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />
      {picking && <PeriodPicker value={month} years={yearsSince(first.data ?? null)} onPick={onMonth} onClose={() => setPicking(false)} />}

      {/*
       * While the peek is open the whole page makes room for it, boxes and table alike, so it covers no figure; the boxes
       * go by the room they have (a container query, not the window's width), so they wrap rather than squeeze. Two
       * across, the ring's box takes the whole row and the bars and This month share the next. Three across from 960:
       * a 1280 window's page (990, or a little less beside a scroll bar) keeps the row it always had.
       */}
      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', peeking && 'mr-[322px]')}>
        {notices}
        <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[478px]:grid-cols-2 @min-[478px]:[&>:first-child]:col-span-2 @min-[960px]:grid-cols-[1.25fr_1fr_0.85fr] @min-[960px]:[&>:first-child]:col-span-1">
          <RingBox
            kind={kind}
            items={legend.items}
            totalMinor={ring.totalMinor}
            currency={ring.currency}
            picked={filters.cat}
            onPick={(id) => setFilter('cat', filters.cat === id ? '' : id)}
            icon={icon}
            ready={ring.ready}
            period={periodLabel(month)}
            footnote={kind === 'expense' ? notMonthly.note : null}
          />
          <DailyBox kind={kind} bars={trend?.bars ?? null} unit={trend?.unit ?? 'day'} currency={trend?.currency ?? ring.currency} today={today} note={periodNote} />
          <MonthBox
            title={month === thisMonth ? 'This month' : periodLabel(month)}
            figures={figures}
            currency={spent.currency}
            review={(count) =>
              count > 0 ? (
                <Link to="/review" search={{ from: 'cashflow' }} className="text-[var(--mac-accent)] hover:underline">
                  {count}
                </Link>
              ) : (
                count
              )
            }
          />
        </div>

        {/*
         * While the peek is open (the page making room for it) the table's columns narrow (`DESK_COLUMNS.peek`): Note and
         * Category keep the room, and no column — the amount least of all — is under the peek.
         * Contained inline, so the table's own minimum width scrolls inside the box rather than widening the page.
         */}
        <section
          className={cx(BOX, 'overflow-hidden [contain:inline-size]')}
          style={{ '--desk-cols': peeking ? DESK_COLUMNS.peek : DESK_COLUMNS.wide } as CSSProperties}
          aria-label="Transactions"
        >
          <h2 className="flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]">
            Transactions
            <span className="flex items-baseline gap-[10px]">
              {/* Notion links of the waiting rows not known yet: a count, no colour (option E). */}
              {unknown > 0 && !cells.hint && (
                <span className={NOTE} data-testid="links-to-pick">
                  {unknownLinksLine(unknown)}
                </span>
              )}
              <span className={NOTE} data-testid="table-note">
                {cells.hint ?? limitNote ?? orderNote(sort)}
              </span>
              {/* Record all (option A, owner 2026-11-18): every waiting row that can be recorded, one toast for them all. */}
              {waiting.length > 0 && !readOnly && (
                <button
                  type="button"
                  data-testid="record-all"
                  disabled={recordingMany || allWaiting.ready.length === 0}
                  title={allWaiting.skipped > 0 ? skippedLine(allWaiting.skipped) : 'Record every waiting row'}
                  onClick={() => void recordMany(allWaiting)}
                  className="self-center rounded-[6px] bg-[var(--ph-ink)] px-[11px] py-[3px] text-[12px] font-medium whitespace-nowrap text-[var(--ph-surface)] disabled:bg-[var(--ph-chevron)] disabled:text-white"
                >
                  {allWaiting.ready.length > 0 ? `Record all ${allWaiting.ready.length}` : 'Record all'}
                </button>
              )}
            </span>
          </h2>
          {cells.line}
          <div className="overflow-x-auto border-t border-[var(--ph-hair)]">
            <div className={cx('text-[13px]', peeking ? 'min-w-[560px]' : 'min-w-[700px]')}>
              <div className={cx(DESK_GRID, 'sticky top-0 border-b border-[var(--ph-hair)] bg-[var(--mac-head)] px-0.5 text-[11px] font-semibold text-[var(--ph-ink-3)]')}>
                <button type="button" aria-sort={ariaSort('date')} onClick={() => sortBy('date')} className="px-2 py-[7px] text-left hover:text-[var(--ph-ink)]">
                  Date{sortMark('date')}
                </button>
                <span className="px-2 py-[7px]">Note</span>
                <span className="px-2 py-[7px]">Category</span>
                <span className="px-2 py-[7px]">Paid with</span>
                <button type="button" aria-sort={ariaSort('amount')} onClick={() => sortBy('amount')} className="px-2 py-[7px] text-right hover:text-[var(--ph-ink)]">
                  Amount{sortMark('amount')}
                </button>
                <span />
              </div>
              {rows.length === 0 && (
                <div className="px-3 py-6 text-center text-[13px] text-[var(--ph-ink-3)]">
                  {emptyText}
                  {narrowed && (
                    <>
                      {' '}
                      <button type="button" onClick={onClearAll} className="text-[var(--mac-accent)] hover:underline">
                        Clear search and filters
                      </button>
                    </>
                  )}
                </div>
              )}
              {/* The month's rows as a list, each an item: a draft is finished in its own cells, the rest open the peek;
                  then the waiting rows (option E), oldest first by when they came in, just above the typing row. */}
              <ul aria-label="Transactions" {...cells.containerProps}>
                {rows.map((row, index) =>
                  row.kind === 'draft' ? (
                    <li key={`d:${row.id}`} className="list-none">
                      <EditableRow row={row} options={rowOptions} accounts={accounts} today={today} baseCurrency={baseCurrency} handlers={deskHandlers} desk={{ striped: index % 2 === 1 }} guess={guessOf(row.id)} paidGuess={paidGuessOf(row.id)} pickedCell={cells.pickedColumn(row.id)} />
                    </li>
                  ) : (
                    <DeskRow
                      key={`t:${row.id}`}
                      row={row}
                      striped={index % 2 === 1}
                      selected={picked.has(row.id)}
                      pickedCell={cells.pickedColumn(row.id)}
                      today={today}
                      accounts={accounts}
                      helpers={helpers}
                      onOpen={(keys) => (peekable(row) ? dispatch(keys ? clickAction(row.id, keys, ids) : { type: 'open', id: row.id }) : !keys?.metaKey && !keys?.shiftKey && row.instalment ? helpers.openInstalment(row) : undefined)}
                      onEdit={() => (peekable(row) ? edit(row) : undefined)}
                    />
                  ),
                )}
                {waiting.map((row, index) => (
                  <li key={`w:${row.id}`} className="list-none" data-testid="waiting-row">
                    <EditableRow
                      row={row}
                      options={rowOptions}
                      accounts={accounts}
                      today={today}
                      baseCurrency={baseCurrency}
                      handlers={deskHandlers}
                      desk={{
                        waiting: true,
                        striped: (rows.length + index) % 2 === 1,
                        selected: picked.has(row.id),
                        // ⌘-click adds the row or takes it out; ⇧-click picks every row from the last one clicked.
                        onPick: (keys) => dispatch(clickAction(row.id, keys, ids)),
                        // Typing in it lets the rows picked go; a ⇧-click on another waiting row reaches from here.
                        onPress: () => dispatch({ type: 'anchor', id: row.id }),
                      }}
                      guess={guessOf(row.id)}
                      paidGuess={paidGuessOf(row.id)}
                      pickedCell={cells.pickedColumn(row.id)}
                    />
                  </li>
                ))}
              </ul>
              {/* The typing row is the table's last row (option E): today's date, Tab across, Return or Record saves it. */}
              {!readOnly && <TypingRow options={rowOptions} accounts={accounts} today={today} baseCurrency={baseCurrency} handlers={deskHandlers} desk={{}} />}
            </div>
          </div>
        </section>
      </div>

      {many && (
        <SelectionPeek top={peekTop} picked={selection.ids.length} spent={bulk.spent} received={bulk.received} actions={bulk} record={recordMore} onClose={() => dispatch({ type: 'close' })} />
      )}
      {selected && (
        <ReceiptPeek
          top={peekTop}
          transactionId={selected.tx!.id}
          notMonthlyOut={!!selected.notMonthlyOut}
          first={at <= 0}
          last={at === peekIds.length - 1}
          onStep={(by) => dispatch({ type: 'step', by, ids: peekIds })}
          onClose={() => dispatch({ type: 'close' })}
        />
      )}
      {cells.picker}
      {/* Rows recorded from the waiting rows went to their own month: where, with Show › there, and Undo (option E). */}
      {recorded && toast && (
        <UndoToast
          key={recorded.items.map((item) => item.draftId).join(',')}
          icon="recorded"
          testId="recorded-toast"
          text={toast.text}
          wide
          extra={
            toast.show !== month ? (
              <button
                type="button"
                onClick={() => {
                  onMonth(toast.show);
                  setRecorded(null);
                }}
                className="shrink-0 rounded-full px-[8px] py-[5px] text-[14px] leading-[18px] font-medium text-[var(--mac-accent)] hover:underline"
              >
                Show ›
              </button>
            ) : null
          }
          onUndo={() => {
            const items = recorded.items;
            setRecorded(null);
            void handlers.unrecord?.(items);
          }}
          onDone={() => setRecorded(null)}
        />
      )}
      {children}
    </div>
  );
}

/** A row of the table, read only: a click selects it and opens the peek, a double-click or Return the edit screen. */
function DeskRow({
  row,
  striped,
  selected,
  pickedCell,
  today,
  accounts,
  helpers,
  onOpen,
  onEdit,
}: {
  row: ListRow;
  striped: boolean;
  selected: boolean;
  /** The column of its cell in a range of blue cells (`useCellRange`), if one is. */
  pickedCell: CellColumn | null;
  today: string;
  accounts: readonly AccountRow[];
  helpers: DeskRowHelpers;
  /** A click, with the keys held (⌘ adds the row, ⇧ a range); Space opens it alone. */
  onOpen: (keys?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => void;
  onEdit: () => void;
}) {
  // Left out of the report (Rp 0, grey) or a not-monthly bill left out of the month (whole, grey, ↻ on its circle): `deskAmount`.
  const amount = deskAmount(row);
  const { notMonthlyOut, extra } = amount;
  const kindLabel = helpers.kindLabel(row);
  const grey = selected ? 'text-white/80' : 'text-[var(--ph-ink-3)]';
  const category = row.categoryName ? `${row.categoryName}${row.moreCounted ? ` +${row.moreCounted}` : ''}` : null;
  const refile = helpers.refile(row);
  // A not-monthly bill a month leaves out wears the phone's small grey ↻ on its category's circle (option D, owner
  // 2026-11-18), its amount grey; no words in the row.
  const mark = (
    <span className="relative inline-flex shrink-0">
      <CategoryIcon categoryId={row.categoryId} accounts={accounts} size="xs" />
      {notMonthlyOut && (
        <span
          role="img"
          aria-label={NOT_MONTHLY_LABEL}
          title={NOT_MONTHLY_LABEL}
          data-testid="not-monthly-badge"
          className={cx(
            'absolute -right-[4px] -bottom-[4px] flex h-[12px] w-[12px] items-center justify-center rounded-full ring-[1.5px]',
            selected ? 'bg-white text-[var(--mac-accent)] ring-[var(--mac-accent)]' : 'bg-[var(--ph-ink-3)] text-[var(--ph-surface)] ring-[var(--ph-surface)]',
          )}
        >
          <Repeat size={7} strokeWidth={3} aria-hidden />
        </span>
      )}
    </span>
  );
  // Each cell is marked for a range of blue cells, and drawn blue while in one.
  const cell = (column: CellColumn) => ({ 'data-cell': column, 'data-cell-row': row.id, 'data-picked': pickedCell === column || undefined });
  const blue = (column: CellColumn) => pickedCell === column && PICKED_CELL;
  return (
    <li
      data-testid="transaction-row"
      data-row-id={row.id}
      data-peek-row={row.id}
      data-not-monthly-out={notMonthlyOut || undefined}
      aria-current={selected ? 'true' : undefined}
      tabIndex={row.sharedTransfer ? undefined : 0}
      title={row.sharedTransfer ? undefined : 'Click to see it · ⌘-click or ⇧-click to pick several · double-click to edit'}
      onClick={row.sharedTransfer ? undefined : (event: ReactMouseEvent) => onOpen({ metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey })}
      onDoubleClick={row.sharedTransfer ? undefined : onEdit}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          onEdit();
        } else if (event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cx(
        DESK_GRID,
        'cursor-default px-0.5 select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--mac-accent)]',
        selected ? 'bg-[var(--mac-accent)] text-white' : cx('text-[var(--ph-ink)]', striped && 'bg-[var(--mac-zebra)]'),
        row.deleted && 'opacity-50',
      )}
    >
      <span {...cell('date')} className={cx('truncate px-2 py-[5px] tabular-nums', grey, blue('date'))}>
        {shortDate(row.date, today)}
      </span>
      <span {...cell('description')} className={cx('flex min-w-0 items-center gap-1.5 px-2 py-[5px]', row.deleted && 'line-through', blue('description'))}>
        <span className="truncate">{row.description || <span className={grey}>{category ?? kindLabel ?? 'No note'}</span>}</span>
        {row.instalment && (
          <span data-testid="instalment-pill" className={cx('shrink-0 rounded-full px-[6px] text-[11px] tabular-nums', selected ? 'bg-white/20' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]')}>
            {row.instalment.number} of {row.instalment.of}
          </span>
        )}
      </span>
      {/* On the selected row's accent the tinted mark sits on white, or it would sink into the blue. */}
      <span {...cell('category')} className={cx('flex min-w-0 items-center gap-[6px] px-2 py-[3px]', selected && '[&_[data-testid=category-mark]]:bg-white!', blue('category'))}>
        {kindLabel ? (
          <span className={cx('truncate', grey)}>{kindLabel}</span>
        ) : (
          <>
            {refile ? (
              <button
                type="button"
                aria-label={categoryButtonLabel(row.description, { refund: !!row.refund, notMonthly: notMonthlyOut })}
                title="Change the category"
                onClick={(event) => {
                  // Re-filing is not opening: the row's own click (the peek) is left alone.
                  event.stopPropagation();
                  refile();
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                className="shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]"
              >
                {mark}
              </button>
            ) : (
              mark
            )}
            <span className="truncate">{category ?? 'Uncategorised'}</span>
          </>
        )}
      </span>
      <span {...cell('paid')} className={cx('truncate px-2 py-[5px]', selected ? 'text-white' : 'text-[var(--ph-ink-2)]', blue('paid'))}>
        {helpers.paidWith(row)}
      </span>
      <span
        {...cell('amount')}
        className={cx('flex items-baseline justify-end gap-[6px] truncate px-2 py-[5px] text-right tabular-nums', amount.tone === 'up' && !selected && 'text-[var(--ph-up)]', amount.tone === 'grey' && !selected && 'text-[var(--ph-ink-3)]', blue('amount'))}
      >
        {extra.length > 0 && (
          <span data-testid="amount-extra" title={extra.map((part) => part.text).join(' · ')} className={cx('truncate text-[11px]', grey)}>
            {extra.map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {/* Said as what it is ("Excluded from report, Rp 85.000"), as the list's line says it. */}
                {part.label ? <span aria-label={part.label}>{part.text}</span> : part.text}
              </span>
            ))}
          </span>
        )}
        <span className="whitespace-nowrap">
          {amount.sign}
          {formatMinor(amount.minor, row.currency)}
        </span>
      </span>
      {/* The last column is the waiting rows' (Record, ✕): a recorded row opens its peek on a click instead. */}
      <span />
    </li>
  );
}
