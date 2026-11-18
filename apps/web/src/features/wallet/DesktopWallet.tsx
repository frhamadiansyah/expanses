import { formatMinor, sumToBase } from '@expanses/core';
import { type AccountRow, listTransactionsIn, setWalletOrder } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Layers } from 'lucide-react';
import { type DragEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { ACCOUNT_ICONS, kindOf } from '../../app/sidebar-model';
import { SUBTYPE_LABELS } from '../../lib/account-types';
import { useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { CARD_W, cardHeightFor, leaveFrom, TwoPersonMark, type WalletCard, WalletFace } from '../../ui/native';
import { BalanceSpark } from '../accounts/BalanceSpark';
import { balanceSeries, crossing, daysBefore } from '../accounts/balance-series';
import { parentTotal, pocketsOf } from '../accounts/pockets';
import { sharedSections } from '../accounts/shared-accounts';
import { dueNowMinor } from '../cards/limit-usage';
import { owedMinor } from '../networth/debt-rows';
import { useOwnedTogether, useOwnerRings, useSharedNetWorth } from '../networth/queries';
import { BOX, NOTE } from '../transactions/CashflowBoxes';
import { BillsToPaySheet } from './BillsToPaySheet';
import { useMoneyOnHand } from './use-money-on-hand';
import { filteredCards, toggleFilter, type WalletFilter, walletFilterSets } from './wallet-balance';
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
import { type PeekSubject, WalletPeek } from './WalletPeek';

/** How long after a peek opens the page makes room for it (and the peek takes clicks): longer than a double-click's gap. */
const ROOM_DELAY_MS = 350;
/** How many days the Balance's line is drawn over: the phone's. */
const SPARK_DAYS = 30;
/** A face's narrowest width, and the gap between two: about five to a row on a Mac window. */
const FACE_MIN = 176;
const GAP = 16;

const GBTN =
  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border border-[var(--ph-chevron)] bg-[var(--ph-surface)] px-[10px] text-[12.5px] whitespace-nowrap text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
const PBTN =
  'inline-flex h-[26px] items-center gap-[3px] rounded-[6px] bg-[var(--ph-ink)] px-[11px] text-[12.5px] font-medium whitespace-nowrap text-[var(--ph-surface)]';
const H2 = 'flex items-baseline justify-between gap-[10px] px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]';
const GROUP_HEAD = 'flex items-baseline justify-between gap-3 text-[11px] font-semibold text-[var(--ph-ink-3)]';
/** A group's name is in capitals; its total keeps the currency's own letters ("Rp", not "RP"). */
const GROUP_TITLE = 'tracking-[0.04em] uppercase';

/** The split bar's colours: the two named, a third named one, and the rest folded together. */
const SPLIT_COLOURS = ['var(--mac-accent)', 'var(--ph-warn)', 'var(--ph-up)'];
const OTHERS_COLOUR = 'var(--ph-ink-3)';

/** What the grid's header names a filter by: the phone's. */
const FILTER_LABELS: Record<WalletFilter, string> = {
  spending: 'Spending money',
  cards: 'Outstanding on cards',
};

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

/**
 * Wallet on a wide screen (Mac Wallet, owner 2026-11-17): a title bar with Cards / List, Points, Reorder and Add
 * account; the Balance box — the phone's figure and rows, with its 30-day line — and where the money sits; then every
 * card Wallet holds, as its own face (the iPhone's art), grouped as bank accounts, cash and e-wallets, credit cards and
 * foreign currency, each group with its total. A click opens a card's side peek, a double-click its page (the phone's
 * raised card over it); a face dragged onto another in its group takes its place in Wallet's order. List shows the same
 * cards as plain rows. The cards, their figures, the Balance and the order are the phone's own (`useMoneyOnHand`,
 * `useWalletCards`), so the sidebar's Accounts and Overview read the same. The phone's Wallet is not this page.
 */
export function DesktopWallet() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidateAll = useInvalidateAll();
  const base = ws.baseCurrency;
  const onHand = useMoneyOnHand();
  const { box, month, wallet } = onHand;
  const { accounts, cards, money, credit, joint, book, all, held, everything, parents, today, ready, laterOnCards } = wallet;

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
        minor: shared.minor,
        currency: shared.currency,
      };
      const baseMinor =
        shared.side === 'money'
          ? sumToBase({
              amounts: [{ minor: shared.minor, currency: shared.currency }],
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
    const pockets = parents.has(account.id) ? pocketsOf(account.id, book) : [];
    if (pockets.length > 0) {
      const total = parentTotal(pockets, all, base, held).totalMinor;
      const item: DeskItem = {
        key: card.key,
        name: card.name,
        side: 'money',
        subtype: account.subtype,
        currencies: pockets.map((pocket) => pocket.currency!),
        minor: total,
        currency: base,
      };
      return [{ card, item, baseMinor: total, account, pockets }];
    }
    const minor = all[account.id] ?? 0;
    const currency = account.currency ?? base;
    const baseMinor = sumToBase({
      amounts: [{ minor, currency }],
      baseCurrency: base,
      ratesToBase: held,
    }).totalMinor;
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

  // ── The Balance box's rows filter the cards, as on the phone's grid ───────────────────────────────────────────────
  const [moneySet, creditSet] = walletFilterSets(money, credit, joint);
  const [filter, setFilter] = useState<WalletFilter | null>(null);
  const figures = box.balanceMinor !== null && box.spendingMinor !== null;
  const filtering = onHand.ready && figures ? filter : null;
  const shown = filteredCards(cards, filtering, moneySet, creditSet).flatMap((card) => deskByKey.get(card.key) ?? []);
  const groups = deskGroups(
    shown.map((entry) => entry.item),
    base,
    held,
  );
  const order = groups.flatMap((group) => group.keys);
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

  // ── The Balance's line: the phone's own reading of the money's last 30 days ───────────────────────────────────────
  const countedIds = money.flatMap((account) => {
    const pockets = pocketsOf(account.id, book);
    return pockets.length > 0 ? pockets.map((pocket) => pocket.id) : [account.id];
  });
  const flows = useQuery({
    queryKey: ['wallet-flows', ws.workspaceId, today, countedIds.join(',')],
    enabled: accounts.isSuccess,
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

  // ── Cards or List, this device's choice ───────────────────────────────────────────────────────────────────────────
  const [view, setViewState] = useState<DeskView>(() => readDeskView());
  const setView = (next: DeskView) => {
    setViewState(next);
    writeDeskView(next);
  };

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
  // The page makes room for the peek a moment after it opens, and the peek takes clicks only then: a double-click on a
  // face (its page) lands both clicks on the face, even one the peek is drawn over for that moment.
  const [room, setRoom] = useState(false);
  useEffect(() => {
    if (!peeking) return setRoom(false);
    const timer = window.setTimeout(() => setRoom(true), ROOM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [peeking]);
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

  /** A card's whole page, as the phone opens it: its face rises from where it was into the raised card. */
  const open = (card: WalletCard, from?: Element | null) => {
    if (!card.to) return;
    if (from) leaveFrom(card.key, from.getBoundingClientRect());
    window.scrollTo(0, 0);
    void navigate({ to: card.to, params: card.params });
  };

  // ── Drag a face onto another in its group: Wallet's order, kept as Reorder cards keeps it ─────────────────────────
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

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="wallet-page" data-desk="true">
      <header
        ref={bar}
        className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]"
      >
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Wallet</h1>
        <span className="flex-1" />
        <div role="radiogroup" aria-label="Wallet view" className="flex rounded-[7px] bg-[var(--ph-fill)] p-[2px] text-[12px]">
          {(['cards', 'list'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={view === value}
              onClick={() => setView(value)}
              className={cx(
                'rounded-[5px] px-[11px] py-[3px] whitespace-nowrap',
                view === value ? 'bg-[var(--ph-selected)] font-medium text-[var(--ph-ink)] shadow-[0_0.5px_1.5px_rgba(0,0,0,0.18)]' : 'text-[var(--ph-ink-2)]',
              )}
            >
              {value === 'cards' ? 'Cards' : 'List'}
            </button>
          ))}
        </div>
        <Link to="/cards/points" className={GBTN}>
          Points
        </Link>
        <Link to="/wallet/reorder" className={GBTN}>
          Reorder
        </Link>
        <Link to="/accounts/add" className={PBTN}>
          <span aria-hidden>＋</span>Add account
        </Link>
      </header>

      {/* The peek makes room on the whole page, so it covers no figure; the boxes go by the room they have. */}
      <div className={cx('@container space-y-[14px] px-[20px] py-[16px]', room && 'mr-[322px]')}>
        <ErrorBox error={orderError ?? accounts.error} />
        {onHand.ready && box.accounts > 0 && (
          <div className="grid grid-cols-1 items-stretch gap-[14px] @min-[720px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
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

        <section className={cx(BOX, 'overflow-clip')} aria-label="Accounts" data-testid="wallet-accounts">
          <h2 className={H2}>
            Accounts
            {filtering ? (
              <span className="flex items-baseline gap-3" data-testid="wallet-filter">
                <span className={NOTE}>
                  {FILTER_LABELS[filtering]} · {shown.length}
                </span>
                <button type="button" onClick={() => setFilter(null)} className="text-[12px] font-normal text-[var(--mac-accent)] hover:underline">
                  Show all
                </button>
              </span>
            ) : (
              <span className={NOTE}>{view === 'cards' ? 'Drag to reorder · click a card to see it' : 'Click a row to see it'}</span>
            )}
          </h2>
          {ready && cards.length === 0 && (
            <p className="px-[14px] pt-1 pb-4 text-[13px] text-[var(--ph-ink-3)]">
              Nothing to spend from yet. Add account adds money or a credit card. Savings, deposits and loans are on{' '}
              <Link to="/net-worth" className="text-[var(--mac-accent)] hover:underline">
                Net worth
              </Link>
              .
            </p>
          )}
          {ready && cards.length > 0 && view === 'cards' && (
            <FaceShelf
              groups={groups}
              desk={deskByKey}
              currency={base}
              peekKey={peekKey}
              dragging={dragging}
              onDragStart={setDragging}
              onDrop={(key) => void drop(key)}
              sameGroup={(a, b) => groupOf(a) === groupOf(b)}
              onFace={onFace}
              onOpen={open}
            />
          )}
          {ready && cards.length > 0 && view === 'list' && (
            <ListTable groups={groups} desk={deskByKey} currency={base} peekKey={peekKey} onPeek={setPeekKey} onOpen={(card) => open(card)} />
          )}
        </section>

        {sharedGroups.map((section) => (
          <section key={section.owner} className={BOX} aria-label={section.title}>
            <h2 className={H2}>{section.title}</h2>
            <ul className="pb-[6px]">
              {section.items.map((item) => (
                <li key={item.itemId} className="border-t border-[var(--ph-hair)]">
                  <Link
                    to="/net-worth/shared/$itemId"
                    params={{ itemId: item.itemId }}
                    data-testid={`shared-item-${item.itemId}`}
                    className="flex items-center gap-[10px] px-[14px] py-[6px] text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
                  >
                    <span
                      className="relative flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]"
                      style={section.ring ? { boxShadow: `0 0 0 1.5px ${section.ring}` } : undefined}
                    >
                      <item.tile size={14} aria-hidden />
                      {together(item.itemId) && <TwoPersonMark />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.name}
                      <span className="sr-only">, {section.ownerName}'s</span>
                    </span>
                    <span className="w-[160px] shrink-0 truncate text-[var(--ph-ink-3)]">{item.kindLabel}</span>
                    <span className="shrink-0 tabular-nums">{formatMinor(item.minor, item.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {peeked && (
        <div className={room ? undefined : 'pointer-events-none'}>
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
        </div>
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
  sub,
}: {
  colour: string;
  label: string;
  /** A small grey line under the label: what the figure is net of. */
  sub?: { text: string; testId: string };
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
        'flex w-full items-center gap-[8px] border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-left text-[13px] hover:bg-[var(--ph-fill)]',
        pressed && 'bg-[var(--mac-accent-wash)] font-semibold hover:bg-[var(--mac-accent-wash)]',
        dimmed ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]',
      )}
    >
      <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: colour, opacity: dimmed ? 0.5 : 1 }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {sub && (
          <span data-testid={sub.testId} className="truncate text-[11.5px] font-normal text-[var(--ph-ink-3)]">
            {sub.text}
          </span>
        )}
      </span>
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
        <p className="px-[14px] pb-3 text-[13px] text-[var(--ph-ink-2)]">
          No {box.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each card below is exact.
        </p>
      </section>
    );
  }
  const bills = box.bills.length > 0;
  return (
    <section className={BOX} aria-label="Balance" data-testid="wallet-balance">
      <h2 className={H2}>
        Balance
        <span className={NOTE}>
          spending money − outstanding on cards
          {bills ? ' − bills still to pay' : ''}
        </span>
      </h2>
      <div className="flex flex-wrap items-center gap-x-[22px] gap-y-2 px-[14px] pb-[12px]">
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
        // What Spending money is net of, so the money groups below and this row tie together.
        sub={box.setAsideMinor !== null && box.setAsideMinor > 0 ? { text: `after ${formatMinor(box.setAsideMinor, currency)} set aside for ${box.setAsideFor}`, testId: 'wallet-setaside-line' } : undefined}
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
        <p className="px-[14px] pb-3 text-[13px] text-[var(--ph-ink-3)]">No money held yet.</p>
      ) : (
        <>
          <div aria-hidden className="mx-[14px] mt-[2px] mb-[10px] flex h-[10px] overflow-hidden rounded-[5px] bg-[var(--ph-track)]">
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
              className="flex items-center gap-[8px] border-t border-[var(--ph-hair)] px-[14px] py-[6px] text-[13px] text-[var(--ph-ink)]"
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

/** The faces, group by group, as many to a row as fit; each one's name under it. */
function FaceShelf({
  groups,
  desk,
  currency,
  peekKey,
  dragging,
  onDragStart,
  onDrop,
  sameGroup,
  onFace,
  onOpen,
}: {
  groups: readonly DeskGroup[];
  desk: ReadonlyMap<string, DeskCard>;
  currency: string;
  peekKey: string | null;
  dragging: string | null;
  onDragStart: (key: string | null) => void;
  onDrop: (key: string) => void;
  sameGroup: (a: string, b: string) => boolean;
  onFace: (key: string) => (event: MouseEvent) => void;
  onOpen: (card: WalletCard, from?: Element | null) => void;
}) {
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
  const scale = cell / CARD_W;
  const over = (key: string) => (event: DragEvent) => {
    if (dragging && dragging !== key && sameGroup(dragging, key)) event.preventDefault();
  };
  return (
    <div ref={shelf} role="region" aria-label="Cards" className="px-[16px] pt-[4px] pb-[16px]">
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
                const { card } = entry;
                return (
                  <div
                    key={key}
                    data-testid="wallet-card"
                    data-key={key}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', key);
                      onDragStart(key);
                    }}
                    onDragEnd={() => onDragStart(null)}
                    onDragOver={over(key)}
                    onDrop={(event) => {
                      event.preventDefault();
                      onDrop(key);
                    }}
                    className={cx('min-w-0', dragging === key && 'opacity-40')}
                  >
                    <div
                      className="relative"
                      style={{
                        width: cell,
                        height: cardHeightFor(cell),
                        borderRadius: radiusFor(scale),
                        boxShadow: peekKey === key ? '0 0 0 3px var(--mac-accent)' : '0 1px 3px rgba(0,0,0,0.18)',
                      }}
                    >
                      <WalletFace card={card} band={false} scale={scale} figure />
                      {card.to && (
                        <Link
                          to={card.to}
                          params={card.params}
                          draggable={false}
                          aria-label={named(card)}
                          aria-current={peekKey === key ? 'true' : undefined}
                          className="ph-focus-inset absolute inset-0 block"
                          style={{ borderRadius: radiusFor(scale) }}
                          onClick={onFace(key)}
                          onDoubleClick={(event) => onOpen(card, event.currentTarget)}
                        />
                      )}
                    </div>
                    <p className="mt-[6px] truncate text-[12.5px] text-[var(--ph-ink)]" aria-hidden>
                      {card.name}
                      {card.whose ? <span className="text-[var(--ph-ink-3)]"> · {card.whose}</span> : null}
                    </p>
                  </div>
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
            <th className="border-b border-[var(--ph-hair)] px-[14px] py-[7px] font-semibold">Name</th>
            <th className="w-[38%] border-b border-[var(--ph-hair)] px-[8px] py-[7px] font-semibold">Kind</th>
            <th className="w-[170px] border-b border-[var(--ph-hair)] px-[14px] py-[7px] text-right font-semibold">Balance</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key} data-testid={`wallet-list-${group.key}`}>
            <tr>
              <td colSpan={3} className="bg-[var(--ph-surface)] px-[14px] pt-[12px] pb-[4px]">
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
                  aria-selected={selected}
                  onClick={() => onPeek(key)}
                  onDoubleClick={() => onOpen(card)}
                  className={cx('cursor-default', selected ? 'bg-[var(--mac-accent)] text-white' : striped ? 'bg-[var(--mac-zebra)]' : undefined)}
                >
                  <td className="px-[14px] py-[5px]">
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
                      'px-[14px] py-[5px] text-right whitespace-nowrap tabular-nums',
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
