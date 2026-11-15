import { categoryPath, formatMinor, isoDate, monthOf, outflowFrom, parseLooseAmount, parseLooseDate, parsePeriod, periodLabel } from '@expanses/core';
import {
  accountIdsInUse,
  cardTopsUpWallet,
  confirmDraft,
  createDraft,
  dismissDraft,
  editDraft,
  guessCategoryFromHistory,
  inBook as workspaceInBook,
  listSharedTransfers,
  listTransactionsIn,
  moveIntoSharedEvent,
  moveTransactionInDay,
  ownerScope,
  postTransaction,
  replaceTransaction,
  type AccountRow,
  type SetAsideChoice,
  setTransactionsCard,
  sharedEventOf,
  tagTransactions,
  eventTagRefusals,
  isBookShared,
  tagDroppedText,
  topUpsCategory,
  type TransactionView,
  uncategorisedTransactionIds,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { CalendarDays, ChevronDown, CircleAlert, CircleCheck, Home, LayoutGrid, List, Pencil, Search, Table2, X } from 'lucide-react';
import type { TransactionsSearch } from '../../app/router';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useRemembered } from '../../lib/page-memory';
import { useApp } from '../../app/context';
import { usePhone, useSideways } from '../../app/use-phone';
import { isNative } from '../../lib/pwa';
import { canPayWith } from '../../lib/account-types';
import { loadPurchasePoints } from '../../lib/purchase-points';
import { isMoneyAccount, moneyHolders, useAccounts, useInOpenBook, useInvalidateAll, useIsBookShared, useResolveRates } from '../../lib/queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useAccountNumberLast4, useCards, useCardsWithArchived, useWalletLast4 } from '../cards/card-queries';
import { useScanReceipt } from '../../capture/use-scan';
import { useDrafts } from '../review/queries';
import { useEvents } from '../events/queries';
import { TravelRows } from '../events/TravelRows';
import { useSharedEventSummaries } from '../events/shared-queries';
import { Button, Card, cx, Empty, ErrorBox, Money } from '../../ui';
import { LargeTitle, SearchPill } from '../../ui/native';
import { SortFilterMenu } from './SortFilterMenu';
import { ChipMenu, type ChipOption } from './ChipMenu';
import { type PaidChoice, PaidWithSheet } from './PaidWithSheet';
import { ConvertForm } from './ConvertForm';
import { isCorrection, isEditable } from './draft';
import { DayHeader } from './DayHeader';
import { CashflowLine } from './CashflowLine';
import { useLineState } from './cashflow-line-store';
import { DayReorder, landed, movedBy, ReorderControls, reorderAttrs, ReorderScope } from './DayReorder';
import { EventSheet } from './EventSheet';
import { keptText, moveHint, stayedBehind } from './shared-move';
import { showToast } from '../../ui/Toast';
import { homesOf, movedText, rowsToMove } from './event-tagging';
import { ReceiptLink } from './ReceiptLink';
import { SelectBar } from './SelectBar';
import { AmountExtra, DraftSubtitle, PaidWith, TransactionRow, useRecategorise } from './TransactionRow';
import { buildRowOptions, QuickRowEditor } from './QuickRowEditor';
import { isQuickEditable, keepsReadFigure, quickFromDraft, quickFromTransaction, type QuickRead, quickToInput, type QuickValues, readQuick, shortDate } from './quick-row';
import { type TableHandlers, TransactionsTable } from './TransactionsTable';
import { accountsWithTransactions, amountExtraParts, buildRows, type CashflowContext, sharedTransferRow, dayTotal, EMPTY_FILTERS, filterRows, groupByCategory, groupByDay, type ListFilters, type ListRow, outsideEvents, type Sort, sortRows, totals } from './list-model';
import { useAssetValues, useTrades } from '../networth/queries';
import { useGoals } from '../goals/queries';
import { type Door, spendingDoor } from '../goals/set-aside-question';
import { asksAboutSetAside, SetAsideSheet } from '../goals/SetAsideQuestion';
import { useShareCategoryIds } from './queries';
import { WaitingBox } from './WaitingBox';
import { Sheet } from '../../app/Sheet';
import { SpendingReport } from './SpendingReport';
import { SidewaysTable } from './SidewaysTable';
import { afterDismiss, afterSideways, afterVisit, readTip, tipShown, writeTip } from './sideways-tip';
import { TransactionCard } from './TransactionCard';
import { deleteTransaction } from './member-transfer';
import { useDeferredDeletes } from './deferred-delete';
import { useDuplicable } from './duplicable';
import { editInsteadIn, openToEditMessage } from '../workspaces/filing';
import { SwitchToEdit } from '../workspaces/SwitchToEdit';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { Unconverted } from '../workspaces/Unconverted';
import { UndoToast } from '../../ui/UndoToast';
import { WorkspaceMenu } from '../workspaces/WorkspaceMenu';
import { EventModeDot, useShownEventMode } from '../events/EventMode';
import { addInCurrency, eventModeApplies } from '../events/event-mode';
import { recordsOnForm } from '../review/draft-form';
import { useBooks, useCategoryBooks, useOpenBook, useWorkspaceBadges } from '../workspaces/queries';
import { ChoiceSheet } from './ChoiceSheet';
import { CardSheet } from '../cards/CardSheet';
import { setCardAccount, sharedCard } from './set-card';
import { draftIn } from './move-workspace';
import { formFromTransaction, formToPost } from './tx-form';
import { ratesForSave } from './tx-save';
import { useJointAccountIds } from '../sharing/net-worth-queries';
import { useOpenBookReadOnly, usePurchasePayers } from '../sharing/queries';
import { payerLine, payerToShow, postedAgainstPlaceholder } from '../sharing/sharing-copy';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** All time reads a longer stretch than one month does; past this many the oldest are left out. */
const ALL_TIME_LIMIT = 5000;

const SORTS: { value: string; label: string; short: string }[] = [
  { value: 'date:desc', label: 'Newest first', short: 'Newest' },
  { value: 'date:asc', label: 'Oldest first', short: 'Oldest' },
  { value: 'amount:desc', label: 'Largest first', short: 'Largest' },
  { value: 'amount:asc', label: 'Smallest first', short: 'Smallest' },
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


/**
 * Where this device says whether opening balances and past purchases are in the list. Nothing on the page sets it any
 * more — the ⋯ menu's "Show opening balances" is gone, and the list keeps them out — but the key is still read, so a
 * device (or a test reaching an opening balance's receipt) can ask for them.
 */
const SHOW_OPENING_KEY = 'transactions-show-opening';
/** The workspace button's letter, with event mode's purple round on its corner while it is on (2E). */
function WorkspaceGlyph({ letter, trip }: { letter: string; trip: boolean }) {
  return (
    <span className="relative flex h-full w-full items-center justify-center">
      <span aria-hidden className="text-[18px] leading-none font-semibold uppercase">
        {letter}
      </span>
      {trip && <EventModeDot className="right-[-4px] bottom-[-4px]" />}
    </span>
  );
}

export function TransactionsPage() {
  const { database, ws, workspaceName } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate({ from: '/transactions' });
  const search = route.useSearch();
  const month = search.month ?? monthOf(isoDate());
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  // Category pickers and filters on this page read the open book; money accounts are every book's.
  const inBook = useInOpenBook();
  // A shared event's own copies of its categories are filed in no book; kept out even before the book's list is read.
  const shareIds = useShareCategoryIds();
  const inOpenBook = (a: AccountRow) => inBook(a) && !shareIds.has(a.id);
  // And no picker on this page offers a set category: they belong to an event (§6). The row editor's cell used
  // to, because it went through a second filter that had no membership test.
  const membershipQuery = useCategorySetMembership();
  const membership = membershipQuery.data ?? {};
  const cardsQuery = useCards();
  const cards = cardsQuery.data ?? [];
  // The digits a row shows when no card paid: a wallet's phone, or a bank account's own number (0080).
  const wallets = useWalletLast4().data;
  const numbers = useAccountNumberLast4().data;
  const walletLast4 = useMemo(() => ({ ...(numbers ?? {}), ...(wallets ?? {}) }), [numbers, wallets]);
  // What a row names may have been put away since; the rows read it from every card, archived ones too.
  const everyCard = useCardsWithArchived().data ?? [];
  const drafts = useDrafts();
  // The filters, the sort and the search box survive an edit or a receipt opened from the list and coming back to it.
  const [filters, setFilters] = useRemembered<Omit<ListFilters, 'month'>>('filters', () => EMPTY_FILTERS);
  // Whether opening balances and past purchases are in the list: off, unless this device was told otherwise.
  const [showOpening] = useState(() => {
    try {
      return localStorage.getItem(SHOW_OPENING_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [sort, setSort] = useRemembered<Sort>('sort', () => ({ key: 'date', dir: 'desc' }));
  const [adding, setAdding] = useState(false);
  // On a phone the search field and the filters are behind their buttons; a wide screen shows both.
  const [showSearch, setShowSearch] = useRemembered<boolean>('show-search', () => false);
  const phone = usePhone();
  /*
   * A phone held sideways shows the table full screen (`SidewaysTable`), whatever view the page was left in. The list
   * stays mounted underneath, hidden, so its chart, its open category and its scroll are all there on turning back.
   */
  const sideways = useSideways();
  const uprightScroll = useRef(0);
  const sidewaysNow = useRef(sideways);
  useEffect(() => {
    // Where the list was, kept while upright: by the time the page knows it has turned, it is already being laid out sideways.
    const keep = () => {
      if (!sidewaysNow.current) uprightScroll.current = window.scrollY;
    };
    keep();
    window.addEventListener('scroll', keep, { passive: true });
    return () => window.removeEventListener('scroll', keep);
  }, []);
  useLayoutEffect(() => {
    const was = sidewaysNow.current;
    sidewaysNow.current = sideways;
    // Upright again: the list is drawn again, and goes back to where it was before the turn.
    if (was && !sideways) window.scrollTo(0, uprightScroll.current);
  }, [sideways]);
  /*
   * "Turn sideways for the table": in the iOS app on a phone, the first few visits, until the table has been opened
   * sideways or the tip closed. Decided once as the page opens, so the visit that uses up the count still shows it.
   */
  const [tipOn, setTipOn] = useState(() => isNative() && tipShown(readTip()));
  const visitCounted = useRef(false);
  useEffect(() => {
    if (!tipOn || visitCounted.current) return;
    visitCounted.current = true;
    writeTip(afterVisit(readTip()));
  }, [tipOn]);
  useEffect(() => {
    if (!sideways || !isNative()) return;
    setTipOn(false);
    const tip = readTip();
    if (!tip.done) writeTip(afterSideways(tip));
  }, [sideways]);
  const dismissTip = () => {
    setTipOn(false);
    writeTip(afterDismiss(readTip()));
  };
  // A phone's Paid with filter is a sheet (`PaidWithSheet`); a wide screen's hangs from its icon.
  const [pickingPaid, setPickingPaid] = useState(false);
  // One copy of the category gesture for the whole screen: the sheet it opens and the Undo toast it leaves.
  const recategorise = useRecategorise();
  // The workspace switcher, reached from the ⋯ menu — the one thing in there that changes the whole app.
  const [choosingWorkspace, setChoosingWorkspace] = useState(false);
  // Event mode on (2E): a small purple round on the workspace button's corner, and nothing else on the page.
  const eventMode = useShownEventMode();
  const openBook = useOpenBook();
  /** The row whose "this is another workspace's" line is showing, because somebody tried to edit it. */
  const [elsewhereId, setElsewhereId] = useState<string | null>(null);
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
  const [kindChosen, setKind] = useState<'expense' | 'income'>('expense');
  // Photographing a receipt is one more way in to the queue; it lands on Review, where the draft it made waits.
  const scan = useScanReceipt();
  /*
   * `?scan=true` — the hold-＋ menu's Scan a receipt and the widget's Receipt (`cicis://add/receipt`) — starts the same
   * scan as the button, once. The address drops it first, so Back or a reload never opens the camera again; the ref
   * keeps StrictMode's second run from starting a second scan.
   */
  const scanStarted = useRef(false);
  useEffect(() => {
    // Dropped from the address: the next Scan a receipt from the menu, while Cashflow stays open, starts its own.
    if (!search.scan) {
      scanStarted.current = false;
      return;
    }
    if (scanStarted.current) return;
    scanStarted.current = true;
    void navigate({ search: (s: TransactionsSearch) => ({ ...s, scan: undefined }), replace: true });
    // A Receipt link while a scan is still open (the app left with the scanner up) starts no second one.
    if (scan.busy) return;
    void scan.scan();
  }, [search.scan]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // The table is the editor, with its own cells to click; ticking rows is the list's.
    if (next === 'table') stopSelecting();
    void navigate({ search: (was: TransactionsSearch) => ({ ...was, view: next }), replace: true });
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private windows can refuse storage; the view still switches for this visit.
    }
  };
  /** The full form, for a transaction too involved to edit as a row. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /*
   * Select mode: rows ticked to be put into an event, or taken out of one, all at once — whatever their dates and
   * categories. While it is on, a row's tap ticks it and does nothing else.
   */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [pickingEvent, setPickingEvent] = useState(false);
  const [tagging, setTagging] = useState<{ busy: boolean; error: unknown }>({ busy: false, error: null });
  /** What the last Add to event or Remove from event did, with the way back. */
  const [tagToast, setTagToast] = useState<{ text: string; back: () => Promise<void> } | null>(null);
  // Move to workspace…: the ticked purchases re-filed in another workspace, each category swapped for its copy there.
  const [pickingBook, setPickingBook] = useState(false);
  // Set card…: which of a credit card account's cards the ticked purchases were made on.
  const [pickingCard, setPickingCard] = useState(false);
  const allBooks = useBooks().data ?? [];
  const categoryBooks = useCategoryBooks().data ?? {};
  const events = useEvents();
  /** A row being edited in place. */
  const [editing, setEditing] = useState<{ kind: 'tx' | 'draft'; id: string; values: QuickValues } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const resolveRates = useResolveRates();
  const today = isoDate();
  const trades = useTrades();
  const goals = useGoals();
  const values = useAssetValues();
  const holdings = (values.data ?? []).filter((row) => row.mode === 'market' || row.mode === 'amount');
  const tradeByTransaction = new Map((trades.data ?? []).filter((trade) => trade.transactionId !== null).map((trade) => [trade.transactionId!, trade]));
  const goalName = (goalId: string | null) => (goalId ? ((goals.data ?? []).find((goal) => goal.id === goalId)?.name ?? 'a goal') : null);
  const [converting, setConverting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  /** A day's rows as they were just dropped, by date, while the write that keeps them there goes out. */
  const [dropped, setDropped] = useState<Record<string, string[]>>({});
  /** A quick row that took promised money, waiting for its question to be answered in a sheet. */
  const [asking, setAsking] = useState<{ door: Door; exclude: string | null; save: (choice: SetAsideChoice | null) => Promise<void>; settle: (saved: boolean) => void } | null>(null);
  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const setSearch = (patch: Partial<TransactionsSearch>) => void navigate({ search: (s: TransactionsSearch) => ({ ...s, ...patch }) });

  const period = parsePeriod(month);
  const range = period?.from ? { from: period.from, to: period.to! } : {};
  // A day on its own only names a date when a single month is showing.
  const singleMonth = period?.kind === 'month';
  const scope = search.account ? accounts.find((a) => a.id === search.account) : undefined;
  const inCategory = scope !== undefined && (scope.kind === 'expense' || scope.kind === 'income');
  // A category opened on the chart is on one side of the ledger, and the chart shows that side while it is open.
  const kind: 'expense' | 'income' = inCategory ? (scope.kind as 'expense' | 'income') : kindChosen;
  /** A category and everything under it: opening Property must show the rent booked to its child. */
  const scopeIds = (() => {
    if (!scope) return undefined;
    const ids = [scope.id];
    for (let i = 0; i < ids.length; i += 1) {
      for (const account of accounts) if (account.parentId === ids[i] && !ids.includes(account.id)) ids.push(account.id);
    }
    return ids;
  })();
  // An account is yours, not a workspace's: its history must hold every workspace, or it will not agree with the
  // statement the bank sends. A category scope stays narrowed, since a category belongs to one workspace anyway.
  const ownerWide = scope !== undefined && isMoneyAccount(scope);
  const listWs = ownerWide ? ownerScope(ws) : ws;
  const list = useQuery({
    queryKey: ['transactions', ws.workspaceId, ws.bookId ?? null, ownerWide, scopeIds?.join(',') ?? 'all', month, filters.showDeleted],
    queryFn: () => listTransactionsIn(database, listWs, { accountIds: scopeIds, ...range, includeVoid: filters.showDeleted, limit: month === 'all' ? ALL_TIME_LIMIT : undefined }),
  });
  // A workspace reads its list in its own currency: the day's total and the month's line say so too. An account's
  // history is owner-wide, so it answers in the owner's currency, as the bank statement beside it does.
  const listCurrency = list.data?.currency ?? ws.baseCurrency;
  /*
   * A swipe's Delete acts at once and offers Undo; the delete itself waits until the toast has gone (`deferred-delete.ts`),
   * so Undo puts back exactly what was there. Until then the row is drawn as gone.
   */
  const swipeDeletes = useDeferredDeletes((id) => deleteTransaction(database, ws, id), invalidate, setError);
  const deleting = swipeDeletes.pending();
  // Event spending is read from the Events page, not here: the ring leaves it out (unless the workspace counts events in
  // its caps), so the list does too — search included. An account's own history keeps it, as its balance does.
  const eventsInCaps = openBook?.countEventsInBudget ?? false;
  const recorded = outsideEvents(list.data?.transactions ?? [], ownerWide || eventsInCaps).filter((tx) => !deleting.has(tx.id));
  // Which workspace each row is filed in, so an account's history says whose spending it is showing.
  const badges = useWorkspaceBadges(recorded.map((tx) => tx.id));
  const badgeOf = badges.of;
  // Household sharing (spec §11): in a shared workspace a purchase names what it was paid with, as the payer's own
  // device named it, and who paid when it was not you — never the placeholder account it is posted against here.
  const shared = useIsBookShared();
  const readOnly = useOpenBookReadOnly();
  const payerOf = usePurchasePayers(
    recorded.map((tx) => tx.id),
    shared,
  );
  /**
   * Paid for by another member: posted here against their placeholder, which no quick editor, table cell or re-file
   * offers as a Paid with. Such a purchase is corrected in the full form, which keeps them as its payer. Decided from
   * the row and the accounts first, so it holds before the payers query answers (fix round 1).
   */
  const duplicable = useDuplicable(recorded);
  const knownAccounts = new Set(accounts.map((account) => account.id));
  const onPlaceholder = (tx: TransactionView) => postedAgainstPlaceholder(tx, knownAccounts);
  // The payer line a row shows instead of its own Paid with: never on a purchase paid from this member's own account,
  // which reads by its digits as in a private workspace.
  const payerShown = (tx: TransactionView) => payerToShow(payerOf(tx.id), tx, knownAccounts);
  const paidByOther = (tx: TransactionView) => {
    const payer = payerOf(tx.id);
    return onPlaceholder(tx) || (payer !== null && !payer.mine);
  };
  /** The workspace a row would have to be opened in before it could be edited; null when this one will do. */
  const elsewhereOf = (transactionId: string) => editInsteadIn(badgeOf(transactionId), ws.bookId);
  /**
   * Whether a row's workspace is known yet. An owner-wide list holds every workspace's rows, and until the
   * badges arrive they all look unfiled — which would read as editable here for that window, and one quick save
   * would re-file another workspace's spending. A list narrowed to one workspace cannot hold another's, so it
   * never waits.
   */
  const filingKnown = !ownerWide || badges.ready;
  // A phone's row has no room for points (they crowded out the note); its receipt and the card's page show them.
  const purchasePoints = useQuery({
    queryKey: ['purchase-points', ws.workspaceId, recorded.map((tx) => tx.id).join(',')],
    enabled: !phone && list.isSuccess && accounts.length > 0,
    queryFn: () => loadPurchasePoints(database, ws, recorded, accounts),
  });

  // A page opened for one account or category shows only the drafts that touch it.
  const pending = (drafts.data ?? []).filter(
    (draft) => !scopeIds || (draft.accountId !== null && scopeIds.includes(draft.accountId)) || (draft.categoryAccountId !== null && scopeIds.includes(draft.categoryAccountId)),
  );
  /*
   * A draft is not a transaction yet, so the list — the ledger's view of the month — holds only what was recorded.
   * The queue is reached through its own row and through Not recorded, which is why asking for it still shows all
   * of it. The table is the exception it has always been: it is the editor, and a half-typed row waiting there is
   * the work in progress that editor exists for.
   */
  // Narrowed to a workspace, a purchase split across workspaces reads as that workspace's part (`listWs.bookId`).
  // The other member's transfers in a shared workspace (0094): redacted rows, read only, beside this phone's own.
  const partnerTransfers = useQuery({
    queryKey: ['shared-transfers', ws.workspaceId, ws.bookId ?? null, month],
    queryFn: () => listSharedTransfers(database, ws.bookId!, range),
    enabled: shared && ws.bookId !== undefined && !scopeIds,
  });
  const rows = [
    ...buildRows(recorded, view === 'table' || sideways || filters.onlyDrafts ? pending : [], accounts, everyCard, walletLast4, listWs.bookId),
    ...(!shared || scopeIds || filters.onlyDrafts ? [] : (partnerTransfers.data ?? []).map(sharedTransferRow)),
  ];
  /*
   * What still waits under Uncategorised — every one of them, whatever period is on show. Tapping the line lists them
   * all (the period goes to All while it does); once the last one has its category, the filter and the period go back.
   */
  const waiting = useQuery({
    queryKey: ['uncategorised-ids', ws.workspaceId, ws.bookId ?? null, ownerWide],
    queryFn: () => uncategorisedTransactionIds(database, listWs),
  });
  const needCategoryCount = waiting.data?.length ?? 0;
  const periodBefore = useRef<string | undefined>(undefined);
  const showNeedsCategory = () => {
    periodBefore.current = search.month;
    setFilter('needsCategory', true);
    setSearch({ month: 'all' });
  };
  const hideNeedsCategory = () => {
    setFilter('needsCategory', false);
    setSearch({ month: periodBefore.current });
  };
  const needsCategoryShown = waiting.isSuccess && filters.needsCategory === true;
  useEffect(() => {
    if (needsCategoryShown && needCategoryCount === 0) hideNeedsCategory();
    // `hideNeedsCategory` is rebuilt every render; what decides is the count reaching nought while the filter is on.
  }, [needsCategoryShown, needCategoryCount]);
  /*
   * Own transfers off Cashflow (owner, 2026-11-13, option C): a transfer between this person's own accounts is listed in
   * no workspace, one touching a joint account or the partner's in the shared workspace alone, until Transfers is on
   * (`transferReach`). A page opened for one account — its own history, archived or not — lists them all, as its
   * statement does; one opened for a category holds no bare transfer anyway.
   */
  const jointIds = useJointAccountIds();
  const cashflow: CashflowContext | undefined = search.account ? undefined : { shared, jointIds };
  const listed = { ...filters, month, showOpening };
  const shown = sortRows(filterRows(rows, listed, accounts, cashflow), sort);
  // Nothing on show but transfers left to the accounts' pages: the empty list offers them rather than "Clear filters".
  const onlyTransfersHidden = shown.length === 0 && !!cashflow && !filters.showTransfers && filterRows(rows, { ...listed, showTransfers: true }, accounts, cashflow).length > 0;
  const sum = totals(shown);
  /*
   * Rows put in order by hand within their day: only in the day-by-day list sorted by date, where a day is a group, and
   * never in a share that ended (read-only) or among deleted rows, which hold no place. A filtered list moves its rows
   * among the ones it shows. Until the write lands, a dropped day keeps the order it was dropped in (`dropped`).
   */
  const reorderable = view === 'list' && grouping === 'date' && sort.key === 'date' && !filters.showDeleted && !readOnly && !selecting;
  const movable = (row: ListRow) => reorderable && row.kind === 'tx' && !row.deleted && row.tx?.status === 'posted';
  const days = groupByDay(shown).map((day) => {
    const order = dropped[day.date];
    if (!order) return day;
    const at = new Map(order.map((id, i) => [id, i]));
    const moving = day.rows.filter((row) => at.has(row.id)).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
    let next = 0;
    return { ...day, rows: day.rows.map((row) => (at.has(row.id) ? moving[next++]! : row)) };
  });
  const movableIds = new Map(days.map((day) => [day.date, day.rows.filter(movable).map((row) => row.id)]));
  // One line, opened by a held ＋ (`CashflowLine`): the field and its card float over the page; a saved row is lit here.
  const lineOn = phone && !sideways && !readOnly;
  const { flashId } = useLineState();
  function reorder(date: string, movedId: string, order: string[]) {
    setDropped((was) => ({ ...was, [date]: order }));
    void run(movedId, () => moveTransactionInDay(database, ws, movedId, order)).finally(() => setDropped((was) => landed(was, date, order)));
  }

  /**
   * Whether a row can be ticked at all: a transaction really recorded, still standing, and this workspace's to change.
   * The very refusals every way in that writes already carries — no draft, nothing deleted, no opening balance or
   * balance correction (`isEditable`), no trade, nothing of another workspace (`elsewhereOf`, and not before the
   * badges say whose a row is), nothing in a share that ended. A row it refuses shows no tick.
   */
  const taggable = (row: ListRow) =>
    row.kind === 'tx' && !row.deleted && !!row.tx && isEditable(row.tx) && !tradeByTransaction.has(row.tx.id) && !readOnly && filingKnown && !elsewhereOf(row.tx.id);
  // Only what is still on the list and still taggable is acted on, whatever was ticked before a filter moved — a
  // transfer Cashflow leaves to the accounts' pages included: it is put on a trip only once Transfers shows it.
  const chosen = shown.filter((row) => selected.has(row.id) && taggable(row));
  // Select All ticks what can be ticked on the list as it is shown, filters and all.
  const selectable = shown.filter(taggable);
  const eventName = (eventId: string) => (events.data ?? []).find((event) => event.id === eventId)?.name;
  // The shared events among them: Add to event moves rows into one rather than tagging them (shared events §6).
  const sharedSummaries = useSharedEventSummaries().data ?? {};

  function startSelecting() {
    close();
    setAdding(false);
    setConverting(null);
    setElsewhereId(null);
    setSelected(new Set());
    setTagging({ busy: false, error: null });
    setSelecting(true);
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setPickingEvent(false);
    setPickingCard(false);
    setTagging({ busy: false, error: null });
  }

  function toggle(id: string) {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Puts every ticked row into one event, or takes them out of whichever they were in — one write
   * (`tagTransactions`), whole or not at all. The toast's Undo puts each row back in the event it came from, so a
   * row moved out of another event by this goes home again rather than nowhere.
   */
  async function tagChosen(eventId: string | null) {
    /*
     * Into a shared event the rows move: they leave this workspace and become this person's own expenses there,
     * keeping their card, MCC, photos and points (§6, D2). It is asked first, in the words the Event row uses, because
     * a move is not a tag a toast can take back. A row the move keeps (a split bill, a transfer) stays
     * ticked, with the reason, so what is left on screen is exactly what did not go.
     */
    // Read from the database, never from the summaries while they load: a shared event taken for a private one here
    // would tag the rows instead of moving them, and a tag stays on this phone alone (sync gaps F2).
    const sharedBook = eventId ? await sharedEventOf(database, ownerScope(ws), eventId) : null;
    if (eventId && sharedBook) {
      if (!window.confirm(moveHint(eventName(eventId) ?? 'the event', sharedSummaries[eventId]?.sharedWith ?? null))) return;
      setTagging({ busy: true, error: null });
      try {
        // The day's rates every move needs: each purchase's currencies and the event's, through the base.
        const target = await sharedEventOf(database, ownerScope(ws), eventId);
        for (const row of chosen) {
          const tx = row.tx!;
          const currencies = [target?.currency, tx.originalCurrency, ...tx.entries.map((e) => e.currency)].filter((c): c is string => !!c);
          await resolveRates([...new Set(currencies)], tx.occurredOn).catch(() => undefined);
        }
        const ids = chosen.map((row) => row.id);
        // Every chosen row comes back moved, listed or kept; one the move said nothing about is kept too, said so.
        const kept = stayedBehind(ids, await moveIntoSharedEvent(database, ownerScope(ws), eventId, ids));
        await invalidate();
        if (kept.length === 0) {
          stopSelecting();
          return;
        }
        setPickingEvent(false);
        setSelected(new Set(kept.map((row) => row.transactionId)));
        setTagging({ busy: false, error: new Error(keptText(kept)) });
      } catch (e) {
        setTagging({ busy: false, error: e });
      }
      return;
    }
    let moving = rowsToMove(
      chosen.map((row) => ({ id: row.id, eventId: row.tx!.eventId ?? null })),
      eventId,
    );
    if (moving.length === 0) {
      stopSelecting();
      return;
    }
    setTagging({ busy: true, error: null });
    // A shared workspace's purchase never takes a tag, and only its payer's phone takes an old one off (sync gaps D1,
    // D3): those stay ticked with the reason, as a move's kept rows do, and the rest are tagged.
    let refused: { transactionId: string; why: string }[] = [];
    try {
      refused = await eventTagRefusals(database, moving.map((row) => row.id), eventId);
      const skip = new Set(refused.map((row) => row.transactionId));
      moving = moving.filter((row) => !skip.has(row.id));
      if (moving.length > 0) await tagTransactions(database, ws, moving.map((row) => row.id), eventId);
      await invalidate();
    } catch (e) {
      setTagging({ busy: false, error: e });
      return;
    }
    if (refused.length > 0) {
      setPickingEvent(false);
      setSelected(new Set(refused.map((row) => row.transactionId)));
      setTagging({ busy: false, error: new Error(keptText(refused)) });
      return;
    }
    stopSelecting();
    setTagToast({
      text: movedText(moving, eventId, eventName),
      back: async () => {
        for (const [was, ids] of homesOf(moving)) await tagTransactions(database, ws, ids, was);
        await invalidate();
      },
    });
  }

  /*
   * Each ticked row is corrected as the form would correct it, with its category (or each split line's) swapped for
   * the copy in the other workspace. One that cannot go — a transfer, which is in every workspace already; a category
   * with no copy there; a row only its own screen can change — stays ticked, with the reason, as Add to event does.
   */
  async function moveChosen(toBook: string) {
    setPickingBook(false);
    setTagging({ busy: true, error: null });
    const where = allBooks.find((book) => book.id === toBook)?.name ?? 'that workspace';
    const kept: { id: string; why: string }[] = [];
    // Into a shared workspace a private event's tag is dropped with the move (sync gaps fix round 1, #5), and said.
    const intoShared = await isBookShared(database, toBook);
    let tagDropped = false;
    for (const row of chosen) {
      const tx = row.tx!;
      const what = tx.description || 'A transaction';
      // Split across workspaces, its parts stay where they are: one is moved by changing its category in the split.
      if (tx.splitBooks) {
        kept.push({ id: tx.id, why: `${what} is split across workspaces: change a part’s category in its split instead` });
        continue;
      }
      try {
        const draft = formFromTransaction(tx, accounts, ws.bookId ?? '');
        // A transfer is filed in the workspace it moves to, with its fee and a withdrawal's or top-up's other half.
        if (draft.mode !== 'expense' && draft.mode !== 'income' && draft.mode !== 'transfer') {
          kept.push({ id: tx.id, why: `${what} moves from its own screen` });
          continue;
        }
        const { draft: next, missing } = draftIn(draft, toBook, accounts, categoryBooks);
        if (missing.length > 0) {
          kept.push({ id: tx.id, why: `${where} has no ${missing[0]} for ${what}` });
          continue;
        }
        // A card top-up names its Top-ups category: the destination's, made there on first need.
        const from = accounts.find((account) => account.id === next.moneyId);
        const to = accounts.find((account) => account.id === next.toId);
        const topsUp = next.mode === 'transfer' && !!from && !!to && cardTopsUpWallet(from, to);
        const post = formToPost(topsUp ? { ...next, topUpCategoryId: await topUpsCategory(database, workspaceInBook(ws, toBook)) } : next, accounts);
        if (post.kind !== 'post') {
          kept.push({ id: tx.id, why: `${what} moves from its own screen` });
          continue;
        }
        const ratesToBase = await ratesForSave({
          database, ws, draft: next, post, accounts, rateDate: tx.occurredOn > isoDate() ? isoDate() : tx.occurredOn, needsRate: null, resolveRates,
          onMissing: () => undefined, where: 'Edit',
        });
        await replaceTransaction(database, ws, tx.id, { ...post.input, ratesToBase, moveToBook: true, toBookId: toBook });
        if (intoShared && tx.eventId && !sharedSummaries[tx.eventId]) tagDropped = true;
      } catch (e) {
        kept.push({ id: tx.id, why: `${what}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    await invalidate();
    if (tagDropped) showToast(tagDroppedText(where));
    if (kept.length === 0) {
      stopSelecting();
      return;
    }
    setSelected(new Set(kept.map((row) => row.id)));
    setTagging({ busy: false, error: new Error(kept.map((row) => row.why).join('. ') + '.') });
  }

  /**
   * Says which card every ticked purchase was made on, in place — one write, whole or not at all. Nothing else about
   * them changes, so nothing is reposted and there is nothing for a toast to take back but the card itself.
   */
  async function setCardChosen(cardId: string) {
    setPickingCard(false);
    setTagging({ busy: true, error: null });
    try {
      await setTransactionsCard(database, ws, chosen.map((row) => row.id), cardId);
      await invalidate();
    } catch (e) {
      setTagging({ busy: false, error: e });
      return;
    }
    stopSelecting();
  }

  const rowOptions = buildRowOptions(accounts, cards, inOpenBook, membership, accountsQuery.isSuccess && cardsQuery.isSuccess && membershipQuery.isSuccess);
  // Only what can pay: the form's own rule, so a locked deposit or a house is not a choice here either.
  const paidKept = filters.paid.startsWith('acct:')
    ? filters.paid.slice('acct:'.length)
    : filters.paid.startsWith('card:')
      ? cards.find((card) => card.id === filters.paid.slice('card:'.length))?.accountId
      : undefined;
  const inUse = useQuery({ queryKey: ['accounts-in-use', ws.workspaceId], queryFn: () => accountIdsInUse(database, ownerScope(ws)) });
  const money = accountsWithTransactions(
    moneyHolders(accounts).filter((account) => canPayWith(account)),
    new Set(inUse.data ?? []),
    paidKept,
  );
  const cardsOf = (accountId: string) => cards.filter((card) => card.accountId === accountId);
  // Set card is offered while every ticked row is on one credit card account carrying two cards or more.
  const creditCards = new Set(accounts.filter((account) => account.subtype === 'credit_card').map((account) => account.id));
  const chosenTxs = chosen.map((row) => row.tx!);
  const cardAccount = setCardAccount(chosenTxs, (id) => creditCards.has(id), cards);
  /*
   * What the list can be narrowed to, each with the digits it is known by — a card's own, else a bank account's number
   * or a wallet's phone (the rows' `walletLast4`) — so "48" finds ···· 4821 on either screen. An account carrying two
   * cards is a row for the account (all its cards) and one per card, by whose it is.
   */
  const paidChoices: PaidChoice[] = money.flatMap((account) => {
    const own = cardsOf(account.id);
    const whole: PaidChoice = { value: `acct:${account.id}`, name: account.name, digits: (own.length === 1 ? own[0]!.last4 : null) ?? walletLast4[account.id] ?? null };
    if (own.length < 2) return [whole];
    return [{ ...whole, digits: null, detail: 'all cards' }, ...own.map((card) => ({ value: `card:${card.id}`, name: card.holderName ?? account.name, digits: card.last4, detail: account.name }))];
  });
  const paidOptions: ChipOption[] = [
    { value: '', label: 'All' },
    ...paidChoices.map((choice) => ({ value: choice.value, label: choice.name, meta: choice.digits ? `···· ${choice.digits}` : choice.detail, keywords: choice.detail, indent: choice.value.startsWith('card:') })),
  ];
  const categoryOptions: ChipOption[] = [
    { value: '', label: 'Any category' },
    ...[...offeredCategories(accounts, 'expense', membership, inOpenBook), ...offeredCategories(accounts, 'income', membership, inOpenBook)]
      .map((a) => ({ value: a.id, label: categoryPath(accounts, a.id), icon: <CategoryIcon categoryId={a.id} accounts={accounts} size="xs" />, indent: a.parentId !== null }))
      .sort((x, y) => x.label.localeCompare(y.label)),
  ];
  const paidPicked = paidOptions.find((option) => option.value === filters.paid && option.value);
  // The donut follows the same filter. A single card of a shared account reads as its account: categories are
  // totalled per account, and the card is one way of paying from it.
  const paidAccountId = filters.paid.startsWith('acct:')
    ? filters.paid.slice('acct:'.length)
    : filters.paid.startsWith('card:')
      ? cards.find((card) => card.id === filters.paid.slice('card:'.length))?.accountId
      : undefined;
  // A category opens as its own screen: its ring, its transactions, and a way back to the month.

  const keptLine = phone ? 'the original is kept' : 'the original stays under Show deleted';
  const keptSentence = phone ? 'The original is kept' : 'The original stays under Show deleted';
  // The chart carries the month's total and its count, so the line that used to say them is left off.
  const chartShown = view === 'list' && !filters.onlyDrafts;  const sortValue = `${sort.key}:${sort.dir}`;
  const narrowed = filters.q || filters.paid || filters.cat || filters.needsCategory || filters.type !== 'all' || filters.showDeleted || filters.showTransfers || filters.onlyDrafts || sortValue !== 'date:desc' || search.month || search.account;

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

  /**
   * Saves in place through `run`, unless the row takes promised money: then the question opens first and the row
   * saves from its sheet. Resolves true only once something was saved — `TransactionsTable`'s TypingRow resets the
   * typed row on true, so resolving true when the sheet merely *opens* (what `run(…, guarded(…))` would do, since
   * `run` returns true after its work) clears the row before anything is saved, and closing the sheet loses it.
   */
  async function guarded(id: string, door: Door | null, exclude: string | null, save: (choice: SetAsideChoice | null) => Promise<void>): Promise<boolean> {
    let asks = false;
    try {
      asks = await asksAboutSetAside(database, ws, door, exclude);
    } catch (e) {
      setError(e);
      return false;
    }
    // Nothing to ask: a new row sends none; an edit sends none too, which clears an answer the row no longer needs.
    if (!asks) return run(id, () => save(null));
    return new Promise<boolean>((settle) => setAsking({ door: door!, exclude, save, settle }));
  }

  function open(row: ListRow) {
    if (busy) return;
    setAdding(false);
    setArmed(null);
    setError(null);
    setConverting(null);
    setElsewhereId(null);
    if (row.kind === 'draft') {
      setEditingId(null);
      setEditing({ kind: 'draft', id: row.id, values: quickFromDraft(row.draft!, today, accounts) });
      return;
    }
    const tx = row.tx!;
    if (tradeByTransaction.has(tx.id) || !isEditable(tx) || !filingKnown) return;
    // An account's history holds every workspace, but this page's category pickers hold only the open one's:
    // saving here would re-file the row into this workspace. Say which one to open instead.
    if (elsewhereOf(tx.id)) {
      setElsewhereId(tx.id);
      return;
    }
    if (isQuickEditable(tx) && !paidByOther(tx)) {
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
    const input = quickToInput(read, accounts);
    return guarded(id, spendingDoor(read.accountId, outflowFrom(input.lines, read.accountId)), id, async (choice) => {
      await replaceTransaction(database, ws, id, { ...input, ratesToBase: await ratesFor(read), setAside: choice });
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
    const input = quickToInput(read, accounts);
    return guarded('typing', spendingDoor(read.accountId, outflowFrom(input.lines, read.accountId)), null, async (choice) => {
      await postTransaction(database, ws, { ...input, ratesToBase: await ratesFor(read), setAside: choice });
    });
  }

  const keepTyped = (values: QuickValues) => run('typing', () => createDraft(database, ws, { source: 'manual', ...draftFields(values) }));
  const keepPasted = (pasted: QuickValues[]) =>
    run('typing', async () => {
      for (const values of pasted) await createDraft(database, ws, { source: 'manual', ...draftFields(values) });
    });

  async function saveDraft(id: string, values: QuickValues, record: boolean): Promise<boolean> {
    const fields = draftFields(values);
    if (!record) {
      // A cell that never showed the draft's figure (read in another currency than the account's) says nothing of it.
      const draft = (drafts.data ?? []).find((d) => d.id === id);
      const { amountMinor: _amount, currency: _currency, ...rest } = fields;
      const patch = draft && keepsReadFigure(draft, values, today, accounts) ? rest : fields;
      return run(id, async () => {
        await editDraft(database, ws, id, patch);
        close();
      });
    }
    // Captured in event mode for a shared event: recorded on its form, where the move into the event is seen (fix round 1).
    const queued = (drafts.data ?? []).find((d) => d.id === id);
    if (queued && recordsOnForm(queued, sharedSummaries)) {
      return run(id, async () => {
        await editDraft(database, ws, id, fields);
        close();
        await navigate({ to: '/review', search: { draft: id } });
      });
    }
    return guarded(id, spendingDoor(fields.accountId ?? '', Math.max(0, fields.amountMinor)), null, async (choice) => {
      await editDraft(database, ws, id, fields);
      await confirmDraft(database, ws, id, { setAside: choice });
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
        title={selecting ? undefined : 'Click to finish'}
        onClick={() => !selecting && open(row)}
        onKeyDown={(event) => !selecting && event.target === event.currentTarget && event.key === 'Enter' && open(row)}
        className="group -mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 opacity-55 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-slate-900"
      >
        <CategoryIcon categoryId={row.categoryId} accounts={accounts} />
        <div className="min-w-0 flex-1">
          {/* The first line is the category, as on every other row; without one it says so. */}
          <div className="truncate text-sm font-medium">{row.categoryName || 'Uncategorised'}</div>
          <div className="truncate text-xs text-slate-500">
            {/* The row already shows what it is missing: "Uncategorised", "—" for the amount, no description,
                no date in its own group. Only the account it was paid with has nowhere else to show. */}
            <DraftSubtitle row={row} />
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
    // The same refusals as Edit: a trade, a row of another workspace or of a partner's payment is not repeated from here.
    const mayDuplicate = duplicable(tx) && !tradeByTransaction.has(tx.id) && !readOnly && filingKnown && !elsewhereOf(tx.id);
    const toDuplicate = () => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId: tx.id } });
    const duplicateButton = mayDuplicate && (
      <button type="button" onClick={toDuplicate} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
        Duplicate
      </button>
    );
    const deleteButton = twoTap(tx.id, 'Delete this transaction', 'Click again to delete', () => deleteTransaction(database, ws, tx.id));
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
              Editing in place · <kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels · {keptLine}
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
              {duplicateButton}
              {deleteButton}
            </>,
          )}
        </li>
      );
    }
    if (editingId === tx.id) {
      return (
        <li key={tx.id} className="py-2">
          <TransactionCard initial={tx} onDone={close} />
          {editHint(<>{keptSentence}</>, <>{purchaseButton}{duplicateButton}{deleteButton}</>)}
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
          ? (row.transferName ?? 'Transfer')
          : row.type === 'opening'
            ? // A holding owned before the app is bought against Opening Balances: a purchase, not a first balance.
              tradeByTransaction.has(tx.id)
              ? 'Past purchase'
              : 'Opening balance'
            : row.type === 'correction'
              ? 'Balance correction'
              : row.leftOut
                ? // The part that counts: its largest category, and how many others are counted beside it.
                  `${row.categoryName ?? ''}${row.moreCounted ? ` +${row.moreCounted}` : ''}`
                : (row.splitPart ?? tx.entries)
                  .filter((e) => e.accountKind === row.type)
                  // The subcategory alone: "Parking & tolls" says Transportation without repeating it.
                  .map((e) => accounts.find((a) => a.id === e.accountId)?.name ?? categoryPath(accounts, e.accountId))
                  .join(', ');
    const goal = goalName(tradeByTransaction.get(tx.id)?.goalId ?? tx.goalId ?? null);
    const points = purchasePoints.data?.[tx.id];
    const trade = tradeByTransaction.get(tx.id) ?? null;
    // Filed in another workspace: it can still be reached and asked about, but it is not dressed as editable.
    // A share that ended here is kept read-only (§8.6): nothing on it is edited, deleted or re-filed.
    const reachable = !trade && isEditable(tx) && !readOnly;
    const elsewhere = reachable ? elsewhereOf(tx.id) : null;
    const clickable = reachable && !elsewhere && filingKnown;
    // A balance correction has no Edit, but it can be deleted: the swipe offers Delete alone.
    const deletableCorrection = !trade && isCorrection(tx) && !readOnly && filingKnown;
    // Every way in that *writes* inherits the same refusals. A trade, an opening balance, a voided row and a
    // purchase filed in another workspace may not be edited, deleted or re-filed from here — by swipe no less
    // than by click. Looking is not writing: on a phone the tap opens the receipt for all of them, because the
    // ⓘ that a desktop reaches a receipt by is `hidden md:inline-flex` and the tap is the only way in. The
    // receipt refuses exactly what this row refuses — `isEditable && !elsewhere && !isTrade` gates its Edit and
    // its Delete, and a row of another workspace is answered there with the same "open that workspace" line.
    const openReceipt = () => void navigate({ to: '/transactions/$transactionId', params: { transactionId: tx.id } });
    const toEdit = () => void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: tx.id } });
    // In a day's own list, by date: the row can be moved within its day.
    const dayIds = !withDate && movable(row) ? movableIds.get(row.date) : undefined;
    const moveBy = (by: -1 | 1) => {
      const order = dayIds && movedBy(dayIds, tx.id, by);
      if (order) reorder(row.date, tx.id, order);
    };
    return (
      <TransactionRow
        key={tx.id}
        row={row}
        accounts={accounts}
        phone={phone}
        // Just saved from One line on this page: lit for a moment where it landed.
        className={flashId === tx.id ? 'ph-line-flash' : undefined}
        itemProps={dayIds ? reorderAttrs(tx.id) : undefined}
        title={clickable ? 'Click to edit' : elsewhere ? openToEditMessage(elsewhere) : undefined}
        // A phone taps for the receipt and swipes for the rest; a desktop keeps its editor in place, untouched.
        // `reachable`, not `clickable`, exactly as before: a purchase filed in another workspace still answers a
        // click — with the note saying where it lives — and only saving it here is refused.
        onOpen={phone ? openReceipt : reachable ? () => open(row) : undefined}
        // The swipe's Edit opens the Add screen on this transaction — the same full card for every one of them,
        // so a correction is never a second screen to learn, and a split, a transfer or a foreign purchase looks
        // like any other. Back from it lands here again. The desktop never reaches `onEdit` at all —
        // `TransactionRow` draws the swipe layer only on a phone — and keeps its editor in place.
        onEdit={clickable ? toEdit : undefined}
        onDuplicate={clickable && mayDuplicate ? toDuplicate : undefined}
        // One tap or a long swipe deletes at once, with Undo on the toast: the delete is written when the toast goes.
        onDelete={clickable || deletableCorrection ? () => void swipeDeletes.begin(tx.id, tx.description ? `Deleted ${tx.description}` : 'Deleted') : undefined}
        // Dead while a write for this row is going out.
        busy={busy === tx.id}
        // Select mode: the tick, where this row can take one; the row's every other gesture waits until it is over.
        select={selecting ? { selected: selected.has(tx.id), onToggle: taggable(row) ? () => toggle(tx.id) : undefined } : undefined}
        // Spec §9's parity row: clicking the icon re-files on a wide screen too, with the same Undo toast.
        onRecategorise={clickable && recategorise.offers(row) && !paidByOther(tx) ? recategorise.start : undefined}
        // Under a category the group already shows the icon, so each row's circle carries its day instead.
        iconLabel={withDate && grouping === 'category' && singleMonth && row.date ? String(Number(row.date.slice(8, 10))) : undefined}
        // Whose spending this is, when the list holds more than one workspace: its letter on the icon's corner.
        iconMark={badges.mark(tx.id) ? <WorkspaceBadge book={badges.mark(tx.id)} corner /> : undefined}
        iconMarkLabel={badges.mark(tx.id)?.name ?? null}
        label={
          <>
            {/* Outside a single month the day alone is ambiguous, so the circle's day gains its month here. */}
            {withDate && (!singleMonth || grouping !== 'category') && <span className="tabular mr-2 font-normal text-slate-500">{shortDate(row.date, today)}</span>}
            {label}
          </>
        }
        subtitle={
          <>
            {tx.description ? `${tx.description} · ` : ''}
            {payerShown(tx) ? (
              payerLine(payerShown(tx)!)
            ) : onPlaceholder(tx) ? null : (
              <PaidWith row={row} />
            )}
            {goal && ` · for ${goal}`}
          </>
        }
        // Asked for by trying to edit it: the row says where it lives, and offers to take you there.
        under={elsewhere && elsewhereId === tx.id ? <SwitchToEdit book={elsewhere} className="mt-0.5 block" /> : undefined}
        // One line under the amount, never two: a transfer's fee, the foreign amount, then — on a wide screen only —
        // the points ("JP¥1.850 · +38 pts").
        amountExtra={<AmountExtra parts={amountExtraParts(tx, phone ? undefined : points, row)} />}
        trailing={
          selecting ? undefined : <>
            {/* A trade is edited on its holding's page: its receipt's Open holding goes there, the row offers no link. */}
            {!trade && clickable && <Pencil size={16} className="hidden text-slate-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 md:block" aria-hidden />}
            <ReceiptLink description={row.description} transactionId={tx.id} />
            {/* A wide screen's way to move it: the ≡ handle, and Move up and Move down without dragging. */}
            {dayIds && dayIds.length > 1 && !phone && (
              <ReorderControls description={row.description} onMove={moveBy} first={dayIds[0] === tx.id} last={dayIds[dayIds.length - 1] === tx.id} />
            )}
          </>
        }
      />
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
    deleteRecorded: (id) => run(id, () => deleteTransaction(database, ws, id)),
    canDuplicate: (tx) => duplicable(tx) && !readOnly && !elsewhereOf(tx.id),
    duplicate: (id) => void navigate({ to: '/transactions/$transactionId/duplicate', params: { transactionId: id } }),
    renderForm: (tx, onDone) => <TransactionCard initial={tx} onDone={onDone} />,
    tradeHoldings: new Map([...tradeByTransaction].map(([transactionId, trade]) => [transactionId, trade.accountId])),
    elsewhereOf,
    // Read-only: no row of an ended share is edited in cells (a typed new row is refused by capture, in words).
    filingKnown: filingKnown && !readOnly,
    payerOf: payerShown,
    paidByOther,
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
            // A phone draws this as the grouping switcher's twin — the same 28px segment in the same 32px track,
            // with the same 15px glyph. A wide screen has room for each segment's label, so the box widens for it.
            'inline-flex h-7 w-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium sm:w-auto sm:px-3',
            view === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
          )}
        >
          <Icon size={15} aria-hidden />
          <span className="hidden sm:inline">{text}</span>
        </button>
      ))}
    </div>
  );

  // The partner's transfer: a plain row, nothing to tap, edit or delete from this phone.
  function sharedTransferView(row: ListRow, withDate: boolean) {
    return (
      <li key={row.id} data-testid="shared-transfer-row" className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2">
        <CategoryIcon categoryId={null} accounts={accounts} transfer />
        <div className="min-w-0 flex-1">
          {/* Named by its accounts ("Cash withdrawal"), the note moves to the grey line, where the default "Transfer" is not repeated. */}
          <div className="truncate text-sm font-medium">{row.transferName ?? (row.description ? `Transfer · ${row.description}` : 'Transfer')}</div>
          {(withDate || row.accountLabel || (row.transferName && row.description && row.description !== 'Transfer')) && (
            <div className="truncate text-xs text-slate-500">
              {[withDate ? row.date : '', row.transferName && row.description !== 'Transfer' ? row.description : '', row.accountLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="tabular text-sm font-semibold whitespace-nowrap text-slate-500">{formatMinor(row.amountMinor, row.currency)}</div>
      </li>
    );
  }
  const rowView = (row: ListRow, withDate = false) => (row.sharedTransfer ? sharedTransferView(row, withDate) : row.kind === 'draft' ? draftRow(row) : recordedRow(row, withDate));

  /**
   * Searching, on a phone: the kit's own pill, drawn in the title's row by `LargeTitle`'s `field` — a corner's 44 px
   * tall, so the field takes the header over without moving the chart below it.
   */
  const searchField = (
    <SearchPill
      value={filters.q}
      onChange={(value) => setFilter('q', value)}
      onClose={() => {
        setFilter('q', '');
        setShowSearch(false);
      }}
      placeholder="Search transactions…"
      label="Search transactions"
    />
  );

  /* baseCurrency is what a row typed into the table is parsed and recorded in, so it stays the owner's. */
  const table = (
    <TransactionsTable
      rows={shown}
      options={rowOptions}
      accounts={accounts}
      today={today}
      baseCurrency={ws.baseCurrency}
      handlers={tableHandlers}
      empty={rows.length === 0 ? 'No transactions in this period yet. Type the first one above.' : 'Nothing matches the search and filters.'}
    />
  );

  return (
    <>
    {/* Relative, so the ⋯ menu hangs from the header it opens from. Hidden, not unmounted, while the phone is sideways. */}
    <div className="relative space-y-4" hidden={sideways}>
      {/*
       * The header is always the kit's title: searching swaps the field into the title's own row rather than replacing
       * the header, so the list and the chart below never move.
       */}
      <LargeTitle
        // The title stays whatever the page is called: a category opened on the chart is named in the ring's middle, not here.
        title="Cashflow"
        oneLine
        max={3}
        field={phone && showSearch ? searchField : undefined}
        actions={
          phone
            ? [
                { key: 'search', label: 'Search', glyph: <Search size={20} aria-hidden />, pressed: showSearch, run: () => setShowSearch((was) => !was) },
                { key: 'workspace', label: `Workspace, ${openBook?.name ?? workspaceName}${eventMode ? `, event mode on for ${eventMode.event.name}` : ''}`, glyph: <WorkspaceGlyph letter={(openBook?.name ?? workspaceName).trim().charAt(0) || '·'} trip={!!eventMode} />, run: () => setChoosingWorkspace(true) },
              ]
            : []
        }
      />
      {tipOn && phone && (
        <div data-testid="sideways-tip" className="-mt-2 flex items-center justify-between gap-2 px-0.5 text-sm text-slate-500">
          Turn sideways for the table
          <button type="button" aria-label="Dismiss" onClick={dismissTip} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {/* A wide screen has room for the switcher and a named button, so its corners stay empty. */}
      {!phone && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2.5">
          {viewSwitcher}
          {!adding && !readOnly && (
            <Button
              onClick={() => {
                close();
                // Event mode in a shared event: the event's own card, as the Add screen opens it.
                if (eventMode?.shared) void navigate({ to: '/transactions/new' });
                else setAdding(true);
              }}
            >
              Add transaction
            </Button>
          )}
          {!readOnly && (
            <Button disabled={scan.busy} onClick={() => void scan.scan()}>
              {scan.busy ? 'Reading the receipt…' : 'Scan a receipt'}
            </Button>
          )}
        </div>
      )}
      {choosingWorkspace && <WorkspaceMenu onClose={() => setChoosingWorkspace(false)} />}
      {adding && (
        <Sheet grouped title="Add a transaction" onClose={() => setAdding(false)}>
          <TransactionCard
            defaultPaidWith
            {...(eventMode && !eventMode.shared && eventModeApplies(eventMode, shared)
              ? {
                  seed: { eventId: eventMode.event.id, ...(addInCurrency(eventMode, ws.baseCurrency) ? { currency: addInCurrency(eventMode, ws.baseCurrency)! } : {}) },
                  eventChip: { eventId: eventMode.event.id, name: eventMode.event.name },
                }
              : {})}
            onDone={() => setAdding(false)}
          />
        </Sheet>
      )}

      <div className="space-y-1">
        {/* The row of chips is a wide screen's; a phone filters from the Sort and filter button. */}
        <div className="hidden flex-wrap items-center gap-2 md:flex">
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
          {/* Hidden on a phone, simply there on a wide screen. */}
          <div className="hidden flex-wrap items-center gap-2 md:flex">
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
              <b className="font-semibold text-slate-900">{formatMinor(sum.spentMinor, listCurrency)}</b> spent
            </>
          )}
          {sum.incomeMinor > 0 && (
            <>
              {' · '}
              <b className="font-semibold text-slate-900">{formatMinor(sum.incomeMinor, listCurrency)}</b> in
            </>
          )}
          {month === 'all' && recorded.length >= ALL_TIME_LIMIT && ` · the newest ${ALL_TIME_LIMIT.toLocaleString('en-GB')} only`}
        </p>
        )}
      </div>

      {/* A trip running now or starting within a week: an entry to its page, not part of the ring or the history. */}
      {chartShown && !search.account && <TravelRows today={today} />}
      {/* The chart leads the list, over whatever period is chosen. */}
      {chartShown && (
        <SpendingReport
          month={month}
          kind={kind}
          // Turning the chart to the other side of the ledger while inside a category leaves the category: the ring
          // and the list under it would otherwise read different things.
          onKind={(next) => {
            setKind(next);
            if (inCategory && next !== kind) setSearch({ account: undefined });
          }}
          categoryId={scope?.kind === 'expense' || scope?.kind === 'income' ? scope.id : undefined}
          onPick={(id) => setSearch({ account: id })}
          onBack={() => setSearch({ account: undefined })}
          onMonth={(next) => setSearch({ month: next === monthOf(today) ? undefined : next })}
          alsoMissing={list.data?.missing ?? []}
          paidAccountId={paidAccountId}
        />
      )}
      {!chartShown && <Unconverted missing={list.data?.missing ?? []} currency={listCurrency} />}
      <ErrorBox error={error ?? scan.error ?? list.error ?? drafts.error} />
      {/* The month's bills and the queue, between the chart and the history: neither is a transaction. */}
      {!inCategory && chartShown && (
        <WaitingBox
          today={today}
          drafts={pending}
          needsCategory={{ count: needCategoryCount, active: filters.needsCategory === true, onShow: showNeedsCategory, onClear: hideNeedsCategory }}
        />
      )}
      {view === 'table' ? (
        // Sideways, the one table is the full-screen one: two typing rows would be two editors of the same month.
        !sideways && table
      ) : (
        <>
          {list.isSuccess && shown.length === 0 &&
            (rows.length === 0 ? (
              <Empty>No transactions in this period.</Empty>
            ) : onlyTransfersHidden ? (
              <Empty>
                Only transfers in this period.{' '}
                <button type="button" onClick={() => setFilter('showTransfers', true)} className="underline">
                  Show transfers
                </button>
              </Empty>
            ) : (
              <Empty>
                Nothing matches{filters.q && ` “${filters.q}”`}.{' '}
                <button type="button" onClick={clearAll} className="underline">
                  Clear search and filters
                </button>
              </Empty>
            ))}

          {shown.length > 0 && (
            <div className="flex items-center justify-end gap-2">
              {/* Names the list under the chart, bold and in its own words, level with the boxes beside it (owner 2026-11-15). */}
              <h2 className="mr-auto text-[20px] leading-[25px] font-bold tracking-[-0.01em] text-[var(--ph-ink)] md:text-[18px] md:leading-[23px]">Transactions</h2>
              {/* Grouping is the view switcher's twin: the same 28px segment, the same 32px track, the same glyph. */}
              <div role="group" aria-label="Group by" className="inline-flex gap-0.5 rounded-lg bg-slate-200 p-0.5">
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
                      grouping === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900',
                    )}
                  >
                    <Icon size={15} aria-hidden />
                  </button>
                ))}
              </div>
              {/* While rows are being ticked the ⋯ square is the dark Select square: one tap stops selecting.
                  The count and the Add to event / Done actions stay in the select bar. */}
              {selecting ? (
                <div className="inline-flex items-center rounded-lg bg-slate-200 p-0.5">
                  <button
                    type="button"
                    aria-label="Select"
                    aria-pressed
                    onClick={stopSelecting}
                    className="flex h-7 w-8 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm"
                  >
                    <CircleCheck size={15} aria-hidden />
                  </button>
                </div>
              ) : (
              /* Select, the sort and what the list was paid with, one ⋯ and one menu. On a phone Paid with opens its sheet. */
              <SortFilterMenu
                sorts={SORTS}
                sortValue={sortValue}
                onSort={(value) => {
                  const [key, dir] = value.split(':') as [Sort['key'], Sort['dir']];
                  setSort({ key, dir });
                }}
                paid={filters.paid}
                paidOptions={paidOptions}
                onPaid={(value) => setFilter('paid', value)}
                onOpenPaid={phone ? () => setPickingPaid(true) : undefined}
                transfers={!!filters.showTransfers}
                onTransfers={cashflow ? (on) => setFilter('showTransfers', on) : undefined}
                onReset={() => {
                  setSort({ key: 'date', dir: 'desc' });
                  setFilter('paid', '');
                  setFilter('showTransfers', false);
                }}
                // Ticking rows, to put a run of them into an event at once: never in a read-only workspace.
                onSelect={view === 'list' && !readOnly ? startSelecting : undefined}
              />
              )}
              {pickingPaid && <PaidWithSheet choices={paidChoices} value={filters.paid} onPick={(value) => setFilter('paid', value)} onClose={() => setPickingPaid(false)} />}
            </div>
          )}

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
                // Signed: a category whose refunds outweigh what it spent comes to less than nothing, and takes that off the whole.
                const whole = groups.reduce((sum, group) => sum + group.totalMinor, 0);
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
                          {/* Less than nothing is money back on the whole: green, as money in. */}
                          <Money minor={group.totalMinor} currency={listCurrency} className={cx('block text-sm font-semibold', group.totalMinor < 0 && 'text-emerald-700')} />
                          {whole > 0 && group.totalMinor !== 0 && (
                            <span className="block text-xs text-slate-500">{Math.round((group.totalMinor / whole) * 100)}%</span>
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
              // One scope around every day: its one touch listener keeps a lifted row's drag from scrolling the page.
              <ReorderScope enabled={phone && reorderable} className="space-y-4">
              {days.map((day) => (
                <Card key={day.date || 'undated'}>
                  <DayHeader date={day.date} net={dayTotal(day.rows)} currency={listCurrency} />
                  <DayReorder
                    className="divide-y divide-slate-100"
                    enabled={(movableIds.get(day.date)?.length ?? 0) > 1}
                    phone={phone}
                    onMove={(movedId, order) => reorder(day.date, movedId, order)}
                  >
                    {day.rows.map((row) => rowView(row))}
                  </DayReorder>
                </Card>
              ))}
              </ReorderScope>
            )
          )}
        </>
      )}

      {/* One line's field on the keyboard, opened by a held ＋. Keyed by the
          workspace and book, so a line typed in one workspace never carries its accounts or category into another. */}
      {lineOn && <CashflowLine key={`${ws.workspaceId}:${ws.bookId ?? ''}`} />}

      {/* The category sheet and its Undo toast, once for the screen rather than once per row. */}
      {recategorise.overlay}

      {/* A swipe's delete, still to be written: Undo takes it back, the toast going by writes it. */}
      {swipeDeletes.shown() && <UndoToast icon="deleted" text={swipeDeletes.shown()!.text} onUndo={swipeDeletes.undo} onDone={swipeDeletes.expire} />}

      {selecting && (
        <>
          {/* Stood down while a sheet it opened is up: drawn above the page, it would sit over that sheet's rows. */}
          {!pickingBook && !pickingEvent && !pickingCard && (
          <SelectBar
            count={chosen.length}
            canRemove={chosen.some((row) => row.tx?.eventId)}
            busy={tagging.busy}
            error={tagging.error}
            onAdd={() => setPickingEvent(true)}
            onRemove={() => void tagChosen(null)}
            onCancel={stopSelecting}
            allSelected={selectable.length > 0 && chosen.length === selectable.length}
            onSelectAll={() => setSelected(chosen.length === selectable.length ? new Set() : new Set(selectable.map((row) => row.id)))}
            {...(allBooks.length > 1 ? { onMove: () => setPickingBook(true) } : {})}
            {...(cardAccount ? { onSetCard: () => setPickingCard(true) } : {})}
          />
          )}
        </>
      )}
      {pickingBook && (
        <ChoiceSheet
          title="Move to workspace"
          value={ws.bookId ?? ''}
          groups={[{ choices: allBooks.map((book) => ({ value: book.id, label: book.name, glyph: <Home size={16} /> })) }]}
          footer="Each category is matched in that workspace; the card or account, amount and date stay as they are."
          onPick={(bookId) => (bookId === ws.bookId ? setPickingBook(false) : void moveChosen(bookId))}
          onClose={() => setPickingBook(false)}
        />
      )}
      {pickingCard && cardAccount && (
        <CardSheet
          title="Set card"
          cards={cardsOf(cardAccount)}
          value={sharedCard(chosenTxs)}
          footer="Only the card changes; the amount, date and category stay as they are."
          onPick={(cardId) => void setCardChosen(cardId)}
          onClose={() => setPickingCard(false)}
        />
      )}
      {pickingEvent && <EventSheet title="Add to event" withNone={false} sharedOnly={shared} value="" onPick={(eventId) => void tagChosen(eventId)} onClose={() => setPickingEvent(false)} />}
      {tagToast && (
        <UndoToast
          icon="event"
          text={tagToast.text}
          onUndo={() => {
            const back = tagToast.back;
            setTagToast(null);
            void back().catch(setError);
          }}
          onDone={() => setTagToast(null)}
        />
      )}

      {asking && (
        <SetAsideSheet
          door={asking.door}
          excludeTransactionId={asking.exclude}
          onSave={async (choice) => {
            await asking.save(choice);
            await invalidate();
            asking.settle(true);
          }}
          // Called after a save too; a promise that already settled true ignores the later false.
          onClose={() => {
            asking.settle(false);
            setAsking(null);
          }}
        />
      )}
    </div>
    {sideways && (
      <SidewaysTable
        month={month}
        onMonth={(next) => setSearch({ month: next === monthOf(today) ? undefined : next })}
        spentMinor={sum.spentMinor}
        currency={listCurrency}
        transfers={cashflow ? { on: !!filters.showTransfers, onChange: (on) => setFilter('showTransfers', on) } : undefined}
      >
        {/* The hidden page's own error line cannot be seen from here, so the table carries one too. */}
        <div className="space-y-2">
          <ErrorBox error={error ?? list.error ?? drafts.error} />
          {table}
        </div>
      </SidewaysTable>
    )}
    </>
  );
}
