import { DeskNotices } from '../../app/DeskNotices';
import { formatMinor, sumToBase } from '@expanses/core';
import { type AccountRow, cardStatement, listCardTerms, listProgrammes, listProgrammeSummaries, listTransactionsIn, refreshProgramme, setWalletOrder } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Award, CalendarCheck, ChevronDown, CreditCard, Layers, LayoutGrid, List as ListIcon } from 'lucide-react';
import { type DragEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { ACCOUNT_ICONS, kindOf } from '../../app/sidebar-model';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { CARD, Card, CARD_HEAD, CARD_NOTE, DeskBar, DeskTitle, type IconColour, PILL, PILL_BLUE, RoundIcon, Seg, Tag, tileMoney } from '../../ui/desk';
import { macV2 } from '../../ui/mac-detail';
import { CARD_W, cardHeightFor, leaveFrom, TwoPersonMark, type WalletCard, WalletFace } from '../../ui/native';
import { usePeekDoubleClick } from '../../ui/native/peek-double-click';
import { BalanceSpark } from '../accounts/BalanceSpark';
import { balanceSeries, crossing, daysBefore } from '../accounts/balance-series';
import { pocketsOf } from '../accounts/pockets';
import { sharedSections } from '../accounts/shared-accounts';
import { formatPoints } from '../cards/format-points';
import { dueNowMinor } from '../cards/limit-usage';
import { earnersLine } from '../cards/programme-text';
import { cycleBack } from '../cards/statement-dates';
import { owedMinor } from '../networth/debt-rows';
import { useOwnedTogether, useOwnerRings, useSharedNetWorth } from '../networth/queries';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { useOpenBook } from '../workspaces/queries';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { BillsToPaySheet } from './BillsToPaySheet';
import { useMoneyOnHand } from './use-money-on-hand';
import { filteredCards, jointFaceMinor, moneyCardMinor, moneyFace, toggleFilter, type WalletFilter, walletFilterSets } from './wallet-balance';
import {
  type DeskGroup,
  deskGroups,
  type DeskItem,
  type DeskView,
  lineChange,
  moneySplit,
  movedOnto,
  readDeskView,
  type SplitPart,
  writeDeskView,
} from './wallet-desk-model';
import { isJointKey, type JointCard, writeJointOrder } from './wallet-joint';
import { byDue, type CardPayment, cardPayment, dayMonth, dueTag, shows, statementLine, walletLine, type WalletShow } from './wallet-v1-model';
import { type PeekSubject, WalletPeek } from './WalletPeek';

/** How many days the Balance's line is drawn over: the phone's. */
const SPARK_DAYS = 30;
/** A face's narrowest width, and the gap between two: about five to a row on a Mac window. */
const FACE_MIN = 176;
const GAP = 16;
/** The Cards card draws its credit cards three across (v1). */
const CARD_COLS = 3;
/** The Points card lists this many programmes; See all opens the rest. */
const POINTS_ROWS = 4;
/** v2 draws this many account tiles over its full face grid (v2 mockup); v1 draws one for every money card. */
const V2_TILES = 4;

const H2 = CARD_HEAD;
const GROUP_HEAD = 'flex items-baseline justify-between gap-3 text-[11px] font-semibold text-[var(--mk-ink-3)]';
/** A group's name is in capitals; its total keeps the currency's own letters ("Rp", not "RP"). */
const GROUP_TITLE = 'tracking-[0.04em] uppercase';
const ROW_LINE = 'border-t border-[var(--mk-line)]';

/** The split bar's colours: the two named, a third named one, and the rest folded together. */
const SPLIT_COLOURS = ['var(--mk-c-blue)', 'var(--mk-c-orange)', 'var(--mk-c-green)'];
const OTHERS_COLOUR = 'var(--mk-ink-3)';

/** What the grid's header names a filter by: the phone's. */
const FILTER_LABELS: Record<WalletFilter, string> = {
  spending: 'Spending money',
  cards: 'Outstanding on cards',
};

const SHOW_OPTIONS: readonly { value: WalletShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cards', label: 'Cards' },
  { value: 'banks', label: 'Banks' },
  { value: 'cash', label: 'Cash' },
];

/** A money tile's round icon: what the money is, in its own colour. */
const TILE_COLOURS: Record<string, IconColour> = {
  bank: 'blue',
  savings: 'orange',
  deposit: 'indigo',
  ewallet: 'teal',
  emoney: 'teal',
  cash: 'green',
  other_cash: 'grey',
};

/** A programme's round icon, by what it counts. */
const UNIT_COLOURS: Record<string, IconColour> = { miles: 'blue', points: 'orange', cashback: 'green' };

/** A card's accessible name, as every Wallet view gives it: the name and the figure. */
const named = (card: WalletCard) => {
  const name = card.label ?? card.name;
  return card.figure && card.figure !== '—' ? `${name}, ${card.figure}` : name;
};
const radiusFor = (scale: number) => Math.round(14.4 * scale);

/** A box's own width, followed as it changes (the peek opening, the window resized). */
function useWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.clientWidth);
    observer.current = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.current.observe(node);
  }, []);
  return [ref, width];
}

/** One Wallet card with what the page reads of it: its figure and group, and the account or joint item behind it. */
interface DeskCard {
  card: WalletCard;
  item: DeskItem;
  /** Its figure in the base currency, for the split bar; money only. */
  baseMinor: number | null;
  account?: AccountRow;
  joint?: JointCard;
  pockets: AccountRow[];
}

/** A credit card's days and last closed statement, as Card payments reads them. */
type CardRead = Pick<Parameters<typeof cardPayment>[0], 'terms' | 'last'>;

/** What a face or tile does: its peek on a click, its page on a double-click, its place by a drag. */
interface FaceActions {
  peekKey: string | null;
  dragging: string | null;
  onDragStart: (key: string | null) => void;
  onDrop: (key: string) => void;
  sameGroup: (a: string, b: string) => boolean;
  onFace: (key: string) => (event: MouseEvent) => void;
  onOpen: (card: WalletCard, from?: Element | null) => void;
}

/** A face or tile's drag: picked up, carried over one of its group (only), dropped there. */
function dragProps(key: string, actions: FaceActions) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
      actions.onDragStart(key);
    },
    onDragEnd: () => actions.onDragStart(null),
    onDragOver: (event: DragEvent) => {
      if (actions.dragging && actions.dragging !== key && actions.sameGroup(actions.dragging, key)) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      actions.onDrop(key);
    },
  };
}

/**
 * Wallet on a wide screen (Mac Wallet; v1 look, owner 2026-11-23, docs/mockups/2026-11-21-mac-redesign-sidebar.html):
 * a title bar with All / Cards / Banks / Cash, Grid / List, the workspace, Reorder and Add account; the credit cards as
 * their faces, three across, each with what it owes and when to pay it, beside the Points card; every money card as a
 * stat tile; Card payments — each card's statement, when it is due. A click opens a card's side peek, a double-click its
 * page (its own Mac page, `DesktopAccount` or `DesktopCard`); a face or tile dragged onto another of its group takes its
 * place in Wallet's order. List shows the same cards as plain rows. v2 (`macV2`) adds today's Balance box — the phone's
 * figure and rows, with its 30-day line — where the money sits, and every card as its own face in its group. The cards,
 * their figures, the Balance and the order are the phone's own (`useMoneyOnHand`, `useWalletCards`), so the sidebar's
 * Accounts and Overview read the same. The phone's Wallet is not this page.
 */
export function DesktopWallet() {
  const { database, ws, workspaceName } = useApp();
  const navigate = useNavigate();
  const invalidateAll = useInvalidateAll();
  const base = ws.baseCurrency;
  const onHand = useMoneyOnHand();
  const { box, month, wallet, setAsides } = onHand;
  const { accounts, cards, money, credit, joint, book, all, held, everything, parents, today, ready, laterOnCards } = wallet;
  const openBook = useOpenBook();
  const [choosingBook, setChoosingBook] = useState(false);

  // ── Each card's figure and group ──────────────────────────────────────────────────────────────────────────────────
  const byId = new Map(everything.map((account) => [account.id, account]));
  const jointByKey = new Map(joint.map((item) => [item.key, item]));
  const desk: DeskCard[] = cards.flatMap((card): DeskCard[] => {
    const shared = jointByKey.get(card.key);
    if (shared) {
      const item: DeskItem = {
        key: card.key,
        name: card.name,
        side: shared.side,
        subtype: shared.subtype,
        currencies: [shared.currency],
        // Joint money is what is free to spend of it, as its face and Spending money count it (`jointFaceMinor`).
        minor: jointFaceMinor(shared),
        currency: shared.currency,
      };
      const baseMinor =
        shared.side === 'money'
          ? sumToBase({
              amounts: [{ minor: jointFaceMinor(shared), currency: shared.currency }],
              baseCurrency: base,
              ratesToBase: held,
            }).totalMinor
          : null;
      return [{ card, item, baseMinor, joint: shared, pockets: [] }];
    }
    const account = byId.get(card.key);
    if (!account) return [];
    if (account.subtype === 'credit_card') {
      const minor = dueNowMinor(owedMinor(all, account.id), laterOnCards[account.id] ?? 0);
      const currency = account.currency ?? base;
      return [
        {
          card,
          item: {
            key: card.key,
            name: card.name,
            side: 'credit',
            subtype: account.subtype,
            currencies: [currency],
            minor,
            currency,
          },
          baseMinor: null,
          account,
          pockets: [],
        },
      ];
    }
    // Money is what is free to spend on it (owner, 22 Nov 2026): its balance less what goals and sinking funds set aside
    // of it, the face's own figure (`moneyFace`), so the money groups add up to Spending money.
    const pockets = parents.has(account.id) ? pocketsOf(account.id, book) : [];
    const face = moneyFace(account, book, all, base, held, setAsides);
    const baseMinor = moneyCardMinor(account, book, all, base, held, setAsides);
    if (pockets.length > 0) {
      const item: DeskItem = {
        key: card.key,
        name: card.name,
        side: 'money',
        subtype: account.subtype,
        currencies: pockets.map((pocket) => pocket.currency!),
        minor: face.minor,
        currency: base,
      };
      return [{ card, item, baseMinor, account, pockets }];
    }
    const minor = face.minor;
    const currency = face.currency;
    return [
      {
        card,
        item: {
          key: card.key,
          name: card.name,
          side: 'money',
          subtype: account.subtype,
          currencies: [currency],
          minor,
          currency,
        },
        baseMinor,
        account,
        pockets: [],
      },
    ];
  });
  const deskByKey = new Map(desk.map((entry) => [entry.card.key, entry]));

  // ── The bar's All / Cards / Banks / Cash, and (v2) the Balance box's rows, filter the cards ───────────────────────────
  const [show, setShow] = useState<WalletShow>('all');
  const [moneySet, creditSet] = walletFilterSets(money, credit, joint);
  const [filter, setFilter] = useState<WalletFilter | null>(null);
  const figures = box.balanceMinor !== null && box.spendingMinor !== null;
  const filtering = macV2 && onHand.ready && figures ? filter : null;
  const shown = filteredCards(cards, filtering, moneySet, creditSet)
    .flatMap((card) => deskByKey.get(card.key) ?? [])
    .filter((entry) => shows(show, entry.item));
  const groups = deskGroups(
    shown.map((entry) => entry.item),
    base,
    held,
  );
  const creditGroup = groups.find((group) => group.key === 'credit');
  const creditShown = (creditGroup?.keys ?? []).flatMap((key) => deskByKey.get(key) ?? []);
  const moneyShown = groups.filter((group) => group.key !== 'credit').flatMap((group) => group.keys.flatMap((key) => deskByKey.get(key) ?? []));
  const split = moneySplit(
    desk
      .filter((entry) => entry.item.side === 'money')
      .map((entry) => ({
        key: entry.card.key,
        name: entry.card.name,
        baseMinor: entry.baseMinor,
      })),
  );
  const [billsOpen, setBillsOpen] = useState(false);

  // ── Each credit card's payment: its last statement and its days, as its own page reads them ───────────────────────
  const ownCredit = desk.filter((entry): entry is DeskCard & { account: AccountRow } => entry.item.side === 'credit' && entry.account !== undefined);
  const statements = useQuery({
    queryKey: ['wallet-card-payments', ws.workspaceId, today, ownCredit.map((entry) => entry.account.id).join(',')],
    enabled: ownCredit.length > 0,
    queryFn: async () => {
      const terms = new Map((await listCardTerms(database, ws)).map((row) => [row.accountId, row]));
      return new Map<string, CardRead>(
        await Promise.all(
          ownCredit.map(async ({ account }): Promise<[string, CardRead]> => {
            const days = terms.get(account.id) ?? null;
            if (!days) return [account.id, { terms: null, last: null }];
            const cycle = cycleBack(today, days.statementDay, 1);
            const read = await cardStatement(database, ws, account.id, cycle, today);
            return [
              account.id,
              { terms: { statementDay: days.statementDay, dueDay: days.dueDay }, last: { cycleEnd: cycle.end, closingMinor: read.closingMinor, leftToPayMinor: read.leftToPayMinor } },
            ];
          }),
        ),
      );
    },
  });
  const paymentOf = (entry: DeskCard): CardPayment | null => {
    if (entry.item.side !== 'credit') return null;
    const read = entry.account ? statements.data?.get(entry.account.id) : undefined;
    if (entry.account && !read) return null;
    return cardPayment({ today, owedNowMinor: entry.item.minor ?? 0, terms: read?.terms ?? null, last: read?.last ?? null });
  };

  // ── The programmes, for the Points card: the phone's own Points list, each ledger brought up to date first ───────────
  const programmes = useQuery({
    queryKey: ['programmes', ws.workspaceId, today],
    queryFn: async () => {
      for (const programme of await listProgrammes(database, ws)) await refreshProgramme(database, ws, programme.id, today);
      return listProgrammeSummaries(database, ws, today);
    },
  });

  // ── The Balance's line: the phone's own reading of the money's last 30 days ───────────────────────────────────────
  const countedIds = money.flatMap((account) => {
    const pockets = pocketsOf(account.id, book);
    return pockets.length > 0 ? pockets.map((pocket) => pocket.id) : [account.id];
  });
  const flows = useQuery({
    queryKey: ['wallet-flows', ws.workspaceId, today, countedIds.join(',')],
    enabled: macV2 && accounts.isSuccess,
    queryFn: async () => {
      const { transactions } = await listTransactionsIn(database, ws, {
        from: daysBefore(today, SPARK_DAYS),
        to: today,
      });
      const ids = new Set(countedIds);
      return transactions.flatMap((transaction) => {
        const minor = transaction.entries.reduce((sum, entry) => (ids.has(entry.accountId) ? sum + entry.amountBaseMinor : sum), 0);
        return minor === 0 ? [] : [{ on: transaction.occurredOn, minor }];
      });
    },
  });
  const series =
    flows.data && box.balanceMinor !== null
      ? balanceSeries({
          todayMinor: box.balanceMinor,
          today,
          days: SPARK_DAYS,
          flows: flows.data,
        })
      : null;
  const change = lineChange(series);

  // ── Grid or List, this device's choice ────────────────────────────────────────────────────────────────────────────
  const [view, setViewState] = useState<DeskView>(() => readDeskView());
  const setView = (next: DeskView) => {
    setViewState(next);
    writeDeskView(next);
  };
  /** v1's grid: the credit faces first, then the money tiles; elsewhere the groups' own order. */
  const order = !macV2 && view === 'cards' ? [...creditShown, ...moneyShown].map((entry) => entry.card.key) : groups.flatMap((group) => group.keys);

  // ── The side peek ─────────────────────────────────────────────────────────────────────────────────────────────────
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peeked = peekKey !== null ? deskByKey.get(peekKey) : undefined;
  const peeking = peeked !== undefined;
  const step = (by: -1 | 1) => {
    if (!peekKey) return;
    const at = order.indexOf(peekKey);
    const next = at < 0 ? undefined : order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) setPeekKey(next);
  };
  const bar = useRef<HTMLElement>(null);
  const [peekTop, setPeekTop] = useState(52);
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
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keys.current = (event: KeyboardEvent) => {
    if (!peekKey) return;
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    if (typing || document.querySelector('[role="dialog"]')) return;
    if (event.key === 'Escape') setPeekKey(null);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') step(1);
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    document.addEventListener('keydown', listen);
    return () => document.removeEventListener('keydown', listen);
  }, []);

  /**
   * A card's whole page: an account's or a credit card's own Mac page, full width; the partner's joint item the phone's
   * raised card over its page, its face rising from where it was.
   */
  const open = (card: WalletCard, from?: Element | null) => {
    if (!card.to) return;
    if (from && isJointKey(card.key)) leaveFrom(card.key, from.getBoundingClientRect());
    window.scrollTo(0, 0);
    void navigate({ to: card.to, params: card.params });
  };
  // The page makes room for the peek as it opens, which can move a face or row from under the pointer: a double-click
  // whose second click lands off the moved one still opens that card's page (`usePeekDoubleClick`), its face rising from
  // where it is now.
  const doubleClick = usePeekDoubleClick((key, from) => {
    const card = deskByKey.get(key)?.card;
    if (card) open(card, view === 'cards' ? from : undefined);
  });

  // ── Drag a face or tile onto another in its group: Wallet's order, kept as Reorder cards keeps it ─────────────────
  const [dragging, setDragging] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<unknown>(null);
  const groupOf = (key: string) => groups.find((group) => group.keys.includes(key))?.key;
  const drop = async (target: string) => {
    const dragged = dragging;
    setDragging(null);
    if (!dragged || groupOf(dragged) !== groupOf(target)) return;
    const next = movedOnto(
      cards.map((card) => card.key),
      dragged,
      target,
    );
    if (!next) return;
    setOrderError(null);
    try {
      // The own cards' places go on the accounts, synced; the partner's joint cards' stay on this device.
      await setWalletOrder(
        database,
        ws,
        next.filter((key) => !isJointKey(key)),
      );
      writeJointOrder(next);
      await invalidateAll();
    } catch (caught) {
      setOrderError(caught);
    }
  };

  // ── Other members' shared items, with separate tax IDs: listed to see and open, counted nowhere here ──────────────
  const sharedNet = useSharedNetWorth().data;
  const together = useOwnedTogether();
  const rings = useOwnerRings()?.rings;
  const carded = new Set(joint.map((card) => card.itemId));
  const sharedGroups = sharedNet
    ? sharedSections(
        sharedNet.group.mode,
        sharedNet.group.members,
        sharedNet.names,
        sharedNet.items.filter((item) => !carded.has(item.itemId)),
        rings,
      )
    : [];

  const onFace = (key: string) => (event: MouseEvent) => {
    event.preventDefault();
    setPeekKey(key);
  };
  const actions: FaceActions = {
    peekKey,
    dragging,
    onDragStart: setDragging,
    onDrop: (key) => void drop(key),
    sameGroup: (a, b) => groupOf(a) === groupOf(b),
    onFace,
    onOpen: open,
  };

  // ── The title's line: the cards, the money accounts, and what the money comes to ──────────────────────────────────
  const moneyCount = desk.filter((entry) => entry.item.side === 'money').length;
  const creditCount = desk.length - moneyCount;
  const line = ready ? walletLine(creditCount, moneyCount, figures && box.spendingMinor !== null ? `${box.estimated ? '≈ ' : ''}${tileMoney(box.spendingMinor, base)}` : null) : undefined;

  const showsCards = show === 'all' || show === 'cards';
  const owedTotal = creditGroup?.totalMinor ?? null;
  const pointsRows = programmes.data ?? [];
  const paymentRows = byDue(
    ownCredit
      .filter((entry) => shows(show, entry.item))
      .flatMap((entry) => {
        const payment = paymentOf(entry);
        return payment ? [{ name: entry.card.name, entry, payment }] : [];
      }),
  );

  const pointsCard = showsCards && pointsRows.length > 0 && (
    <PointsCard rows={pointsRows} desk={deskByKey} />
  );
  const paymentsCard = showsCards && ownCredit.length > 0 && <PaymentsCard rows={paymentRows} currency={base} />;
  const empty = ready && cards.length === 0 && (
    <p className="px-[20px] pt-1 pb-4 text-[13px] text-[var(--mk-ink-2)]">
      Nothing to spend from yet. Add account adds money or a credit card. Savings, deposits and loans are on{' '}
      <Link to="/net-worth" className="text-[var(--mk-blue)] hover:underline">
        Net worth
      </Link>
      .
    </p>
  );
  const filterNote = filtering ? (
    <span className="flex items-baseline gap-3" data-testid="wallet-filter">
      <span className={NOTE}>
        {FILTER_LABELS[filtering]} · {shown.length}
      </span>
      <button type="button" onClick={() => setFilter(null)} className="text-[12px] font-normal text-[var(--mk-blue)] hover:underline">
        Show all
      </button>
    </span>
  ) : (
    <span className={NOTE}>{view === 'cards' ? 'Drag to reorder · click a card to see it' : 'Click a row to see it'}</span>
  );
  const listCard = (
    <section className={cx(BOX, 'overflow-clip')} aria-label="Accounts" data-testid="wallet-accounts">
      <h2 className={cx(H2, 'justify-between')}>
        Accounts
        {filterNote}
      </h2>
      {empty}
      {ready && shown.length > 0 && <ListTable groups={groups} desk={deskByKey} currency={base} peekKey={peekKey} onPeek={setPeekKey} onOpen={(card) => open(card)} />}
    </section>
  );

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="wallet-page" data-desk="true" {...doubleClick}>
      <DeskBar crumb="Wallet" barRef={bar}>
        <Seg label="Show" value={show} onChange={setShow} options={SHOW_OPTIONS} testId="wallet-show" />
        <Seg
          label="Wallet view"
          value={view}
          onChange={setView}
          options={[
            { value: 'cards', label: <ViewIcon icon={LayoutGrid} name="Grid" /> },
            { value: 'list', label: <ViewIcon icon={ListIcon} name="List" /> },
          ]}
        />
        <button type="button" className={PILL} onClick={() => setChoosingBook(true)} aria-haspopup="dialog" data-testid="wallet-workspace">
          <span className="max-w-[140px] truncate">{openBook?.name ?? workspaceName}</span>
          <ChevronDown size={14} aria-hidden className="-mr-[3px] text-[var(--mk-ink-2)]" />
        </button>
        {macV2 && (
          <Link to="/cards/points" className={PILL}>
            Points
          </Link>
        )}
        <Link to="/wallet/reorder" className={PILL}>
          Reorder
        </Link>
        <Link to="/accounts/add" className={PILL_BLUE}>
          <span aria-hidden>＋</span>Add account
        </Link>
      </DeskBar>
      {choosingBook && <WorkspaceSheet onClose={() => setChoosingBook(false)} />}
      {/* The app's notices, under the title bar rather than above it. */}
      <DeskNotices />
      <DeskTitle title="Wallet" line={line} />

      {/* The peek makes room on the whole page, so it covers no figure; the boxes go by the room they have. */}
      <div className={cx('@container space-y-[16px] px-[32px] pt-[2px] pb-[32px]', peeking && 'mr-[322px]')}>
        <ErrorBox error={orderError ?? accounts.error ?? statements.error ?? programmes.error} />

        {macV2 ? (
          <>
            {onHand.ready && box.accounts > 0 && (
              <div className="grid grid-cols-1 items-stretch gap-[16px] @min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <BalanceBox
                  box={box}
                  figures={figures}
                  currency={base}
                  series={series}
                  change={change}
                  filtering={filtering}
                  onFilter={(tapped) => setFilter((current) => toggleFilter(current, tapped))}
                  onBills={() => {
                    setFilter(null);
                    setBillsOpen(true);
                  }}
                />
                <SplitBox parts={split} desk={deskByKey} />
              </div>
            )}
            {moneyShown.length > 0 && <MoneyTiles entries={moneyShown.slice(0, V2_TILES)} actions={actions} grouped={false} />}
            <div className="grid grid-cols-1 items-start gap-[16px] @min-[980px]:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
              {view === 'cards' ? (
                <section className={cx(BOX, 'overflow-clip')} aria-label="Accounts" data-testid="wallet-accounts">
                  <h2 className={cx(H2, 'justify-between')}>
                    Accounts
                    {filterNote}
                  </h2>
                  {empty}
                  {ready && shown.length > 0 && <FaceShelf groups={groups} desk={deskByKey} currency={base} actions={actions} />}
                </section>
              ) : (
                listCard
              )}
              {(pointsCard || paymentsCard) && (
                <div className="space-y-[16px]">
                  {pointsCard}
                  {paymentsCard}
                </div>
              )}
            </div>
          </>
        ) : view === 'cards' ? (
          <>
            {/* Every face and tile is one region, as the e2e journeys and a screen reader find a card in it. */}
            <div role="region" aria-label="Cards" data-testid="wallet-accounts" className="space-y-[16px]">
              {empty && <section className={CARD}>{empty}</section>}
              {(creditShown.length > 0 || pointsCard) && (
                <div className={cx('grid grid-cols-1 items-stretch gap-[16px]', creditShown.length > 0 && pointsCard && '@min-[860px]:grid-cols-[minmax(0,2.45fr)_minmax(250px,1fr)]')}>
                  {creditShown.length > 0 && (
                    <CardsCard
                      entries={creditShown}
                      owedMinor={owedTotal}
                      currency={base}
                      paymentOf={paymentOf}
                      actions={actions}
                    />
                  )}
                  {pointsCard}
                </div>
              )}
              {moneyShown.length > 0 && <MoneyTiles entries={moneyShown} actions={actions} grouped groups={groups} />}
            </div>
            {paymentsCard}
          </>
        ) : (
          <>
            {listCard}
            {(pointsCard || paymentsCard) && (
              <div className={cx('grid grid-cols-1 items-start gap-[16px]', pointsCard && paymentsCard && '@min-[860px]:grid-cols-[minmax(0,2.45fr)_minmax(250px,1fr)]')}>
                {paymentsCard}
                {pointsCard}
              </div>
            )}
          </>
        )}

        {sharedGroups.map((section) => (
          <section key={section.owner} className={BOX} aria-label={section.title}>
            <h2 className={H2}>{section.title}</h2>
            <ul className="pb-[6px]">
              {section.items.map((item) => (
                <li key={item.itemId} className={ROW_LINE}>
                  <Link
                    to="/net-worth/shared/$itemId"
                    params={{ itemId: item.itemId }}
                    data-testid={`shared-item-${item.itemId}`}
                    className="flex items-center gap-[10px] px-[20px] py-[7px] text-[13px] text-[var(--mk-ink)] hover:bg-[var(--mk-pill)]"
                  >
                    <span
                      className="relative flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-[var(--mk-pill)] text-[var(--mk-ink-2)]"
                      style={section.ring ? { boxShadow: `0 0 0 1.5px ${section.ring}` } : undefined}
                    >
                      <item.tile size={14} aria-hidden />
                      {together(item.itemId) && <TwoPersonMark />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.name}
                      <span className="sr-only">, {section.ownerName}'s</span>
                    </span>
                    <span className="w-[160px] shrink-0 truncate text-[var(--mk-ink-2)]">{item.kindLabel}</span>
                    <span className="shrink-0 tabular-nums">{formatMinor(item.minor, item.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {peeked && (
        <WalletPeek
          key={peeked.card.key}
          subject={peeked satisfies PeekSubject}
          top={peekTop}
          first={order.indexOf(peeked.card.key) <= 0}
          last={order.indexOf(peeked.card.key) === -1 || order.indexOf(peeked.card.key) === order.length - 1}
          onStep={step}
          onClose={() => setPeekKey(null)}
          onOpen={() => open(peeked.card)}
        />
      )}

      {billsOpen && (
        <BillsToPaySheet
          bills={box.bills}
          month={month}
          totalMinor={box.billsMinor ?? 0}
          currency={base}
          accounts={everything}
          onClose={() => setBillsOpen(false)}
        />
      )}
    </div>
  );
}

/** A Grid / List segment: its icon, its word for a screen reader. */
function ViewIcon({ icon: Icon, name }: { icon: typeof LayoutGrid; name: string }) {
  return (
    <span className="flex h-[19px] items-center" title={name}>
      <Icon size={15} strokeWidth={2} aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** One face: the card's art at the width given, its link over it (a click its peek, a double-click its page), dragged by its group. */
function FaceCell({ entry, cell, actions, children }: { entry: DeskCard; cell: number; actions: FaceActions; children: ReactNode }) {
  const { card } = entry;
  const key = card.key;
  const scale = cell / CARD_W;
  return (
    <div data-testid="wallet-card" data-key={key} {...dragProps(key, actions)} className={cx('min-w-0', actions.dragging === key && 'opacity-40')}>
      <div
        className="relative"
        style={{
          width: cell,
          height: cardHeightFor(cell),
          borderRadius: radiusFor(scale),
          boxShadow: actions.peekKey === key ? '0 0 0 3px var(--mk-blue)' : '0 1px 3px rgba(0,0,0,0.18)',
        }}
      >
        <WalletFace card={card} band={false} scale={scale} figure={macV2} />
        {card.to && (
          <Link
            to={card.to}
            params={card.params}
            draggable={false}
            aria-label={named(card)}
            aria-current={actions.peekKey === key ? 'true' : undefined}
            data-peek-row={key}
            className="ph-focus-inset absolute inset-0 block"
            style={{ borderRadius: radiusFor(scale) }}
            onClick={actions.onFace(key)}
            onDoubleClick={(event) => actions.onOpen(card, event.currentTarget)}
          />
        )}
      </div>
      {children}
    </div>
  );
}

/** v1's Cards card: the credit cards' faces three across, what each owes and when to pay it under it; what they all owe. */
function CardsCard({
  entries,
  owedMinor: owed,
  currency,
  paymentOf,
  actions,
}: {
  entries: readonly DeskCard[];
  owedMinor: number | null;
  currency: string;
  paymentOf: (entry: DeskCard) => CardPayment | null;
  actions: FaceActions;
}) {
  const [shelf, width] = useWidth<HTMLDivElement>();
  const cell = width === 0 ? 0 : Math.floor((width - GAP * (CARD_COLS - 1)) / CARD_COLS);
  return (
    <Card
      title="Cards"
      icon={CreditCard}
      label="Credit cards"
      testId="wallet-group-credit"
      note={owed !== null && owed !== 0 ? <span data-testid="wallet-cards-owed">{tileMoney(Math.abs(owed), currency)} owed</span> : undefined}
    >
      <div ref={shelf} className="grid px-[20px] pb-[18px]" style={{ gridTemplateColumns: `repeat(${CARD_COLS}, minmax(0, 1fr))`, columnGap: GAP, rowGap: 14 }}>
        {cell > 0 &&
          entries.map((entry) => {
            const payment = paymentOf(entry);
            const by = payment ? (payment.state === 'paid' ? 'Paid' : payment.dueOn ? `Pay by ${dayMonth(payment.dueOn)}` : null) : null;
            return (
              <FaceCell key={entry.card.key} entry={entry} cell={cell} actions={actions}>
                <p className="mt-[8px] flex items-baseline justify-between gap-[8px]" aria-hidden>
                  <span data-testid="wallet-card-owed" className="truncate text-[14px] font-bold text-[var(--mk-ink)] tabular-nums">
                    {formatMinor(Math.max(0, entry.item.minor ?? 0), entry.item.currency)}
                  </span>
                  {by && <span className="shrink-0 text-[12.5px] text-[var(--mk-ink-2)]">{by}</span>}
                </p>
                {entry.card.whose && <p className="truncate text-[12px] text-[var(--mk-ink-2)]">{entry.card.whose}</p>}
              </FaceCell>
            );
          })}
      </div>
    </Card>
  );
}

/** The money cards as v1's stat tiles: a round icon for what it is, its figure, its name. Grouped (v1) so a drag stays in its group. */
function MoneyTiles({ entries, actions, grouped, groups }: { entries: readonly DeskCard[]; actions: FaceActions; grouped: boolean; groups?: readonly DeskGroup[] }) {
  const tile = (entry: DeskCard) => <MoneyTile key={entry.card.key} entry={entry} actions={actions} />;
  return (
    <div className="grid grid-cols-2 gap-[16px] @min-[860px]:grid-cols-4">
      {grouped && groups
        ? groups
            .filter((group) => group.key !== 'credit')
            .map((group) => (
              // Each group a contents box: the tiles flow as one grid, the group still named for a drag and a test.
              <div key={group.key} data-testid={`wallet-group-${group.key}`} className="contents">
                {group.keys.flatMap((key) => entries.find((entry) => entry.card.key === key) ?? []).map(tile)}
              </div>
            ))
        : entries.map(tile)}
    </div>
  );
}

function MoneyTile({ entry, actions }: { entry: DeskCard; actions: FaceActions }) {
  const { card, item } = entry;
  const key = card.key;
  const kind = kindOf({ subtype: item.subtype as AccountRow['subtype'] });
  const foreign = item.currencies.some((currency) => currency !== item.currency) || entry.pockets.length > 0;
  const on = actions.peekKey === key;
  return (
    <div
      data-testid="wallet-card"
      data-key={key}
      {...dragProps(key, actions)}
      className={cx(CARD, 'relative min-w-0 px-[20px] py-[18px] hover:bg-[var(--mk-pill)]', actions.dragging === key && 'opacity-40')}
      style={on ? { boxShadow: '0 0 0 3px var(--mk-blue)' } : undefined}
    >
      <span className="flex h-[26px] items-center justify-between gap-2">
        <RoundIcon icon={ACCOUNT_ICONS[kind]} colour={TILE_COLOURS[item.subtype] ?? 'grey'} />
        {foreign && <Tag tone="grey">{entry.pockets.length > 0 ? `${entry.pockets.length} pockets` : item.currency}</Tag>}
      </span>
      <span data-testid="face-figure" className="mt-[14px] mb-[3px] block truncate text-[26px] leading-[32px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)] tabular-nums">
        {item.minor === null ? '–' : tileMoney(item.minor, item.currency)}
      </span>
      <span className="block truncate text-[13px] text-[var(--mk-ink-2)]">
        {card.name}
        {card.whose ? ` · ${card.whose}` : ''}
      </span>
      {card.to && (
        <Link
          to={card.to}
          params={card.params}
          draggable={false}
          aria-label={named(card)}
          aria-current={on ? 'true' : undefined}
          data-peek-row={key}
          className="ph-focus-inset absolute inset-0 block rounded-[18px]"
          onClick={actions.onFace(key)}
          onDoubleClick={(event) => actions.onOpen(card, event.currentTarget)}
        />
      )}
    </div>
  );
}

type ProgrammeSummary = Awaited<ReturnType<typeof listProgrammeSummaries>>[number];

/** The Points card: each programme's balance, the card it is earned with, See all for the Points page. */
function PointsCard({ rows, desk }: { rows: readonly ProgrammeSummary[]; desk: ReadonlyMap<string, DeskCard> }) {
  /** The card a programme is earned with, short: "BCA 4417", or the card's name, or how many cards. */
  const earnedWith = (earners: ProgrammeSummary['earners']) => {
    if (earners.length !== 1) return earnersLine(earners);
    const card = desk.get(earners[0]!.cardAccountId)?.card;
    return card?.issuer && card.last4 ? `${card.issuer} ${card.last4}` : earners[0]!.cardName;
  };
  return (
    <Card
      title="Points"
      icon={Award}
      testId="wallet-points"
      note={
        <Link to="/cards/points" className="font-semibold text-[var(--mk-blue)] hover:underline" data-testid="points-link">
          See all
        </Link>
      }
    >
      <ul className="mx-[20px] pb-[10px]">
        {rows.slice(0, POINTS_ROWS).map(({ programme, earners, balance }) => (
          <li key={programme.id} className={ROW_LINE}>
            <Link
              to="/cards/points/$programmeId"
              params={{ programmeId: programme.id }}
              data-testid="wallet-points-row"
              className="-mx-[8px] flex items-center gap-[11px] rounded-[10px] px-[8px] py-[9px] hover:bg-[var(--mk-pill)]"
            >
              <RoundIcon icon={Award} colour={UNIT_COLOURS[programme.unit] ?? 'grey'} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-[var(--mk-ink)]">{programme.name}</span>
                <span className="block truncate text-[12.5px] text-[var(--mk-ink-2)]">{earnedWith(earners)}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[14px] font-bold text-[var(--mk-ink)] tabular-nums">{formatPoints(balance.total)}</span>
                <span className="block text-[12px] text-[var(--mk-ink-2)]">{programme.unit}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Card payments: each card's statement — what the bank asks for, by when, when the statement closed — soonest first. */
function PaymentsCard({ rows, currency }: { rows: readonly { name: string; entry: DeskCard; payment: CardPayment }[]; currency: string }) {
  return (
    <Card
      title="Card payments"
      icon={CalendarCheck}
      testId="wallet-payments"
      className="@container"
      note={
        <Link to="/bills" className="font-semibold text-[var(--mk-blue)] hover:underline">
          Bills ›
        </Link>
      }
    >
      <ul className="mx-[20px] pb-[10px]">
        {rows.length === 0 && <li className={cx(ROW_LINE, 'py-[10px] text-[13px] text-[var(--mk-ink-2)]')}>Reading the statements…</li>}
        {rows.map(({ entry, payment }) => {
          const tag = dueTag(payment);
          const thumb = 48;
          return (
            <li key={entry.card.key} className={ROW_LINE}>
              <Link
                to="/cards/$cardId/statement"
                params={{ cardId: entry.card.key }}
                data-testid="wallet-payment-row"
                className="-mx-[8px] flex items-center gap-[12px] rounded-[10px] px-[8px] py-[9px] hover:bg-[var(--mk-pill)]"
              >
                <span aria-hidden className="relative shrink-0 overflow-hidden" style={{ width: thumb, height: cardHeightFor(thumb), borderRadius: 4 }}>
                  <WalletFace card={entry.card} band={false} scale={thumb / CARD_W} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[var(--mk-ink)]">
                    {entry.card.name}
                    {entry.card.last4 ? ` ···· ${entry.card.last4}` : ''}
                  </span>
                  <span className="block truncate text-[12.5px] text-[var(--mk-ink-2)]">{statementLine(payment)}</span>
                </span>
                {/* Narrow (v2's side column): the figure over its tag; wide: the tag, then the figure. */}
                <span className="flex shrink-0 flex-col items-end gap-[3px] @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:gap-[16px]">
                  <span className="text-right text-[14px] font-bold text-[var(--mk-ink)] tabular-nums @min-[560px]:order-last @min-[560px]:w-[120px]">
                    {formatMinor(payment.amountMinor, entry.item.currency ?? currency)}
                  </span>
                  {tag && (
                    <Tag tone={payment.tone} testId="wallet-payment-due">
                      {tag}
                    </Tag>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** One row of the Balance box: the line's colour, what it is, its figure. Spending money and Outstanding on cards filter the cards; Bills opens its sheet. */
function BoxRow({
  colour,
  label,
  value,
  currency,
  onClick,
  pressed,
  dimmed,
  chevron = false,
  testId,
}: {
  colour: string;
  label: string;
  value: number;
  currency: string;
  onClick: () => void;
  pressed?: boolean;
  dimmed: boolean;
  chevron?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-haspopup={chevron ? 'dialog' : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'flex w-full items-center gap-[8px] border-t border-[var(--ph-hair)] px-[20px] py-[7px] text-left text-[13px] hover:bg-[var(--ph-fill)]',
        pressed && 'bg-[var(--mac-accent-wash)] font-semibold hover:bg-[var(--mac-accent-wash)]',
        dimmed ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]',
      )}
    >
      <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: colour, opacity: dimmed ? 0.5 : 1 }} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{formatMinor(value, currency)}</span>
      {pressed && <span className="shrink-0 text-[11px] text-[var(--ph-ink-3)]">✓</span>}
      {chevron && (
        <span aria-hidden className="shrink-0 text-[var(--ph-chevron)]">
          ›
        </span>
      )}
    </button>
  );
}

function BalanceBox({
  box,
  figures,
  currency,
  series,
  change,
  filtering,
  onFilter,
  onBills,
}: {
  box: ReturnType<typeof useMoneyOnHand>['box'];
  figures: boolean;
  currency: string;
  series: ReturnType<typeof balanceSeries> | null;
  change: number | null;
  filtering: WalletFilter | null;
  onFilter: (tapped: WalletFilter) => void;
  onBills: () => void;
}) {
  if (!figures || box.balanceMinor === null || box.spendingMinor === null) {
    return (
      <section className={BOX} aria-label="Balance" data-testid="wallet-balance">
        <h2 className={H2}>Balance</h2>
        <p className="px-[20px] pb-4 text-[13px] text-[var(--mk-ink-2)]">
          No {box.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each card below is exact.
        </p>
      </section>
    );
  }
  const bills = box.bills.length > 0;
  return (
    <section className={BOX} aria-label="Balance" data-testid="wallet-balance">
      <h2 className={cx(H2, 'justify-between')}>
        Balance
        <span className={cx(NOTE, 'truncate')}>
          spending money − outstanding on cards
          {bills ? ' − bills still to pay' : ''}
        </span>
      </h2>
      <div className="flex flex-wrap items-center gap-x-[22px] gap-y-2 px-[20px] pb-[12px]">
        <div className="min-w-0">
          <p data-testid="wallet-balance-figure" className="text-[26px] leading-[32px] font-semibold whitespace-nowrap text-[var(--ph-ink)] tabular-nums">
            {box.estimated && <span className="text-[var(--ph-ink-3)]">≈ </span>}
            {formatMinor(box.balanceMinor, currency)}
          </p>
          {change !== null && (
            <p data-testid="wallet-balance-change" className="mt-[2px] text-[12px] text-[var(--ph-ink-3)] tabular-nums">
              {change > 0 ? '+' : ''}
              {formatMinor(change, currency)} in 30 days
            </p>
          )}
        </div>
        {series && (
          <div className="max-w-[340px] min-w-[200px] flex-1">
            <BalanceSpark series={series} currency={currency} crossing={crossing(series)} plot={52} />
          </div>
        )}
      </div>
      <BoxRow
        colour="var(--ph-up)"
        label="Spending money"
        value={box.spendingMinor}
        currency={currency}
        pressed={filtering === 'spending'}
        dimmed={filtering !== null && filtering !== 'spending'}
        onClick={() => onFilter('spending')}
        testId="wallet-spending-row"
      />
      <BoxRow
        colour="var(--ph-alarm)"
        label="Outstanding on cards"
        value={-(box.cardsMinor ?? 0)}
        currency={currency}
        pressed={filtering === 'cards'}
        dimmed={filtering !== null && filtering !== 'cards'}
        onClick={() => onFilter('cards')}
        testId="wallet-cards-row"
      />
      {bills && (
        <BoxRow
          colour="var(--ph-warn)"
          label="Bills still to pay"
          value={-(box.billsMinor ?? 0)}
          currency={currency}
          dimmed={filtering !== null}
          chevron
          onClick={onBills}
          testId="wallet-bills-row"
        />
      )}
    </section>
  );
}

/** A money card's kind as the sidebar draws it: a bank, cash, a wallet; the rest folded together. */
function KindIcon({ subtype, colour }: { subtype: string | null; colour?: string }) {
  const Icon = subtype === null ? Layers : ACCOUNT_ICONS[kindOf({ subtype: subtype as AccountRow['subtype'] })];
  return (
    <span
      aria-hidden
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)]"
      style={{ color: colour ?? 'var(--ph-dot)' }}
    >
      <Icon size={13} strokeWidth={1.8} />
    </span>
  );
}

/** Where the money sits: one bar split by money card, the two largest named and the rest folded together, with each one's share. */
function SplitBox({ parts, desk }: { parts: readonly SplitPart[]; desk: ReadonlyMap<string, DeskCard> }) {
  const colourOf = (part: SplitPart, index: number) => (part.count > 1 ? OTHERS_COLOUR : (SPLIT_COLOURS[index] ?? OTHERS_COLOUR));
  return (
    <section className={BOX} aria-label="Where the money sits" data-testid="wallet-split">
      <h2 className={H2}>Where the money sits</h2>
      {parts.length === 0 ? (
        <p className="px-[20px] pb-3 text-[13px] text-[var(--ph-ink-3)]">No money held yet.</p>
      ) : (
        <>
          <div aria-hidden className="mx-[20px] mt-[2px] mb-[10px] flex h-[10px] overflow-hidden rounded-[5px] bg-[var(--ph-track)]">
            {parts.map((part, index) => (
              <i
                key={part.key}
                className="block h-full"
                style={{
                  width: `${part.percent}%`,
                  background: colourOf(part, index),
                }}
              />
            ))}
          </div>
          {parts.map((part, index) => (
            <div
              key={part.key}
              data-testid="wallet-split-row"
              className="flex items-center gap-[8px] border-t border-[var(--ph-hair)] px-[20px] py-[6px] text-[13px] text-[var(--ph-ink)]"
            >
              <KindIcon subtype={part.count > 1 ? null : (desk.get(part.key)?.item.subtype ?? 'bank')} colour={colourOf(part, index)} />
              <span className="min-w-0 flex-1 truncate">{part.count > 1 ? `${part.name} · ${part.count} accounts` : part.name}</span>
              <span className="shrink-0 text-[var(--ph-ink-3)] tabular-nums">{part.percent}%</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** A group's header: its name and its total in the base currency, "≈" where some was converted. */
function GroupTotal({ group, currency }: { group: DeskGroup; currency: string }) {
  return (
    <span data-testid="wallet-group-total" className="tabular-nums">
      {group.totalMinor === null ? '–' : `${group.approx ? '≈ ' : ''}${formatMinor(group.totalMinor, currency)}`}
    </span>
  );
}

/** The faces, group by group, as many to a row as fit; each one's name under it (v2). */
function FaceShelf({ groups, desk, currency, actions }: { groups: readonly DeskGroup[]; desk: ReadonlyMap<string, DeskCard>; currency: string; actions: FaceActions }) {
  const [shelf, width] = useWidth<HTMLDivElement>();
  /*
   * The faces' count to a row follows the shelf's width, and the page's height follows the rows: where scrollbars take
   * room (not the Mac's own, which float), a scrollbar coming and going would change the width it was measured at and
   * the faces would never settle. The page keeps the scrollbar's room while the shelf is drawn.
   */
  useEffect(() => {
    const root = document.documentElement;
    const before = root.style.scrollbarGutter;
    root.style.scrollbarGutter = 'stable';
    return () => {
      root.style.scrollbarGutter = before;
    };
  }, []);
  const cols = width === 0 ? 0 : Math.max(1, Math.floor((width + GAP) / (FACE_MIN + GAP)));
  const cell = cols === 0 ? 0 : Math.floor((width - GAP * (cols - 1)) / cols);
  return (
    <div ref={shelf} role="region" aria-label="Cards" className="px-[20px] pt-[4px] pb-[16px]">
      {cell > 0 &&
        groups.map((group) => (
          <div key={group.key} data-testid={`wallet-group-${group.key}`} className="mt-[6px]">
            <h3 className={cx(GROUP_HEAD, 'mb-[8px]')}>
              <span className={GROUP_TITLE}>
                {group.title}
                {group.key === 'credit' && ' · outstanding'}
              </span>
              <GroupTotal group={group} currency={currency} />
            </h3>
            <div
              className="mb-[10px] grid"
              style={{
                gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
                columnGap: GAP,
                rowGap: 12,
              }}
            >
              {group.keys.map((key) => {
                const entry = desk.get(key);
                if (!entry) return null;
                return (
                  <FaceCell key={key} entry={entry} cell={cell} actions={actions}>
                    <p className="mt-[6px] truncate text-[12.5px] text-[var(--mk-ink)]" aria-hidden>
                      {entry.card.name}
                      {entry.card.whose ? <span className="text-[var(--mk-ink-2)]"> · {entry.card.whose}</span> : null}
                    </p>
                  </FaceCell>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

/** The same cards as plain rows: the kind's icon, the name, what it is, its figure; the groups and their totals as in Cards. */
function ListTable({
  groups,
  desk,
  currency,
  peekKey,
  onPeek,
  onOpen,
}: {
  groups: readonly DeskGroup[];
  desk: ReadonlyMap<string, DeskCard>;
  currency: string;
  peekKey: string | null;
  onPeek: (key: string) => void;
  onOpen: (card: WalletCard) => void;
}) {
  let index = 0;
  return (
    <div role="region" aria-label="Accounts list" className="border-t border-[var(--ph-hair)]">
      <table className="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--mac-head)] text-left text-[11px] font-semibold text-[var(--ph-ink-3)]">
            <th className="border-b border-[var(--ph-hair)] px-[20px] py-[7px] font-semibold">Name</th>
            <th className="w-[38%] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Kind</th>
            <th className="w-[170px] border-b border-[var(--ph-hair)] px-[20px] py-[7px] text-right font-semibold">Balance</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key} data-testid={`wallet-list-${group.key}`}>
            <tr>
              <td colSpan={3} className="bg-[var(--ph-surface)] px-[20px] pt-[12px] pb-[4px]">
                <span className={GROUP_HEAD}>
                  <span className={GROUP_TITLE}>{group.title}</span>
                  <GroupTotal group={group} currency={currency} />
                </span>
              </td>
            </tr>
            {group.keys.map((key) => {
              const entry = desk.get(key);
              if (!entry) return null;
              const { card, item, joint } = entry;
              const striped = index++ % 2 === 1;
              const selected = peekKey === key;
              const kind = [
                joint ? `${joint.ownerName}’s` : null,
                SUBTYPE_LABELS[item.subtype as keyof typeof SUBTYPE_LABELS] ?? item.subtype,
                entry.pockets.length > 0 ? `${entry.pockets.length} pockets` : item.currency,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <tr
                  key={key}
                  data-testid="wallet-list-row"
                  data-peek-row={key}
                  aria-selected={selected}
                  onClick={() => onPeek(key)}
                  onDoubleClick={() => onOpen(card)}
                  className={cx('cursor-default', selected ? 'bg-[var(--mac-accent)] text-white' : striped ? 'bg-[var(--mac-zebra)]' : undefined)}
                >
                  <td className="px-[20px] py-[5px]">
                    <span className="flex min-w-0 items-center gap-[8px]">
                      <KindIcon subtype={item.subtype} colour={selected ? 'var(--mac-accent)' : undefined} />
                      <button type="button" aria-label={named(card)} onClick={() => onPeek(key)} className="min-w-0 truncate text-left">
                        {card.name}
                      </button>
                    </span>
                  </td>
                  <td className={cx('truncate px-[8px] py-[5px]', !selected && 'text-[var(--ph-ink-3)]')}>{kind}</td>
                  <td
                    className={cx(
                      'px-[20px] py-[5px] text-right whitespace-nowrap tabular-nums',
                      !selected && item.side === 'credit' && 'text-[var(--ph-alarm)]',
                    )}
                  >
                    {item.side === 'credit' ? formatMinor(-(item.minor ?? 0), item.currency) : card.figure}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
