import { formatMinor, periodMonthOf } from '@expanses/core';
import { useMonthStart } from '../workspaces/queries';
import { listTransactionsIn } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { ArrowUpDown, Award, Check, GalleryHorizontal, LayoutGrid, Layers, Plus, Settings, Sparkles, Store, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { cx, Empty, Money } from '../../ui';
import { CardStack, CornerButton, type CornerAction, heroFigure, InsetGroup, InsetRow, LargeTitle, Panel } from '../../ui/native';
import { BalanceSpark } from '../accounts/BalanceSpark';
import { balanceSeries, crossing, daysBefore } from '../accounts/balance-series';
import { pocketsOf } from '../accounts/pockets';
import { useHeldRates } from '../accounts/queries';
import { sharedSections } from '../accounts/shared-accounts';
import { billCurrencyOf } from '../bills/bill-view';
import { useBillsInMonth } from '../debt-plan/queries';
import { useSetAsideViews } from '../goals/queries';
import { useOwnedTogether, useOwnerRings, useSharedNetWorth } from '../networth/queries';
import { BillsToPaySheet } from './BillsToPaySheet';
import { useWalletCards } from './useWalletCards';
import { filteredCards, toggleFilter, walletBox, type WalletFilter, walletFilterSets } from './wallet-balance';
import { jointKey } from './wallet-joint';
import { WALLET_VIEW_LABELS, WALLET_VIEWS, changeWalletView, useWalletView } from './wallet-view';
import { WalletCarousel, WalletGrid } from './WalletViews';

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

/** Where the stack sits in the history, kept for as long as the reader stays in the wallet's pages. */
let stackAt: number | null = null;
let watching = false;

/** How many days of history the Balance box's line is drawn over. */
const SPARK_DAYS = 30;

/**
 * One share of the Balance box: a dot in the line's own colour, what it is called, and its figure on the right. The
 * legend and the picture are one thing, so the dot's colour is the line's colour and never a colour of its own.
 *
 * Each share is a button. Spending money and Outstanding on cards filter the grid under the box to the cards they are
 * made of (`pressed`), on their own tint with a ✓, the other rows greyed meanwhile (`dimmed`); Bills still to pay opens its
 * sheet, so it carries a chevron instead.
 */
function SpendRow({
  colour,
  label,
  value,
  currency,
  onClick,
  pressed,
  tint,
  dimmed = false,
  chevron = false,
  testId,
}: {
  colour: string;
  label: string;
  value: number;
  currency: string;
  onClick: () => void;
  /** A filter row's state; absent on a row that opens something instead. */
  pressed?: boolean;
  /** The ground a pressed row is laid on. */
  tint?: string;
  dimmed?: boolean;
  chevron?: boolean;
  testId?: string;
}) {
  const ink = dimmed ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]';
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-haspopup={chevron ? 'dialog' : undefined}
      onClick={onClick}
      data-testid={testId}
      className="ph-focus -mx-[6px] flex w-[calc(100%+12px)] items-center justify-between gap-[10px] rounded-[8px] px-[6px] py-[7px] text-left"
      style={{ background: pressed ? tint : undefined }}
    >
      <span className="flex min-w-0 items-center gap-[7px]">
        <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: colour, opacity: dimmed ? 0.5 : 1 }} />
        <span className={cx('truncate text-[15px] leading-[20px]', pressed ? 'font-semibold' : 'font-medium', ink)}>{label}</span>
      </span>
      <span className="flex shrink-0 items-center gap-[4px]">
        <span className={cx('tabular text-[15px] leading-[20px]', pressed ? 'font-semibold' : 'font-medium', ink)}>{formatMinor(value, currency)}</span>
        {pressed && <Check aria-hidden size={15} className="text-[var(--ph-ink-3)]" />}
        {chevron && (
          <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
        )}
      </span>
    </button>
  );
}

/** A hairline between two of the box's rows. */
const Hair = () => <div aria-hidden className="border-t-[0.5px] border-[var(--ph-hair)]" />;

/** What the grid's header names a filter by. */
const FILTER_LABELS: Record<WalletFilter, string> = { spending: 'Spending money', cards: 'Outstanding on cards' };

/**
 * `/wallet` — everything money is spent from or owed on, as one Wallet stack. It is what the Accounts page and the
 * Cards tab were, folded into one place (owner, 23 Oct).
 *
 * At the top, the Balance box the Accounts page drew: what is left of the money kept for spending once goals have
 * had their share and the credit cards are paid, with the month behind it. The eye in the corner hides it — on this
 * device, remembered — and the stack moves up into its place. Then the cards, back to front: the bank accounts a
 * debit card spends from, cash, digital wallets, and the credit cards in front (`walletMoney`, `walletCredit`) — or,
 * once ⋯ → Reorder cards has put them in an order by hand, that order, money and credit cards mixed (`walletOrder`). Every
 * card's band carries its figure — a balance, or what a credit card owes — unmasked. Then the points programmes the
 * cards earn into, and, with separate tax IDs, the other members' shared items.
 *
 * What the two pages also held has moved to where it is read: savings switched off "For spending", deposits and a
 * broker's cash are on Net worth's Assets; money lent to a person is Assets' Receivables; loans and money owed to a
 * person are Liabilities. Lend & borrow keeps its own page.
 *
 * Opening a card works as the Cards tab did, after Apple Wallet: this route stays mounted while a card's page is its
 * child, so the card's own element rises to the top, the others slide away, and the page fades in below it. A credit
 * card opens its card page (`/cards/$cardId`); money opens its account page (`/accounts/$accountId`), drawn under the
 * raised card in the same layout — its round actions, what is set aside and free, and its recent rows. ✕, Back, Escape
 * or a tap on the raised card put it back; ⚙ opens its settings. An account or a card that is not in the stack — a
 * deposit, savings kept aside, a pocket — opens its page on its own, as it always has.
 */
export function WalletPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const { cardId, accountId, itemId } = useParams({ strict: false }) as { cardId?: string; accountId?: string; itemId?: string };
  // A partner's joint card is opened by its item id, and known in the stack by its own key.
  const openId = cardId ?? accountId ?? (itemId !== undefined ? jointKey(itemId) : undefined);
  // Wallet's cards, drawn and in order (`useWalletCards`), and the money they were read from.
  const { accounts, balances, everything, all, book, money, credit, joint, rates, held, today, cards: wallet, ready, laterOnCards, plansRead } = useWalletCards();
  const setAsides = useSetAsideViews();
  const shared = useSharedNetWorth().data;
  const together = useOwnedTogether();
  const rings = useOwnerRings()?.rings;
  // A joint item is a card above, so it is not listed a second time under "Rina's, shared".
  const carded = new Set(joint.map((card) => card.itemId));
  const sharedGroups = shared ? sharedSections(shared.group.mode, shared.group.members, shared.names, shared.items.filter((item) => !carded.has(item.itemId)), rings) : [];
  // What the filter rows keep: the money cards and the credit cards, the partner's joint ones with the own.
  const [moneySet, creditSet] = walletFilterSets(money, credit, joint);

  // How the cards are laid out on this device: the pile, a grid, or one at a time (`wallet-view`).
  const view = useWalletView();
  // The pile and the carousel are the cards and nothing else; the grid always has the Balance box over it.
  const boxed = view === 'grid';

  /*
   * The Balance box: money kept for spending, less what goals have claimed of it, less what is outstanding on the
   * credit cards — what each owes, billed or not, less only its instalments not billed yet (owner, 17 Nov 2026) — less
   * the bills still to pay this month (`walletBox`). Loans and money owed to people are not here any more: they are
   * read against a year's schedule on Net worth's Liabilities, not as this month's claim on the money in a pocket. A rate short and there is no
   * figure; the missing currency is named instead.
   */
  // This month's bills, as the Recurring page reads them — the workspace's month ("Month starts on"), each bill by the
  // bill month whose day falls inside it; read only while the box is on screen.
  const month = periodMonthOf(today, useMonthStart());
  const monthBills = useBillsInMonth(boxed ? month : null, { workspaceMonth: true });
  const billRows = (monthBills.data ?? []).map((row) => ({
    id: row.bill.id,
    name: row.bill.name,
    categoryAccountId: row.bill.categoryAccountId,
    // Each row is this month's occurrence by construction (its bill month may be the calendar month before).
    month,
    state: row.state,
    payBy: row.window.payBy,
    amountMinor: row.bill.amountMinor,
    estimateMinor: row.estimateMinor,
    currency: billCurrencyOf(row.bill, everything, ws.baseCurrency),
  }));
  // A bill may be in a currency no card holds: its rate is read beside the cards' own.
  const billRates = useHeldRates(billRows.map((row) => row.currency));
  const box = walletBox({
    book,
    balances: all,
    credit,
    baseCurrency: ws.baseCurrency,
    rates: { ...held, ...(billRates.data?.rates ?? {}) },
    setAsides: Object.values(setAsides.data ?? {}),
    bills: billRows,
    month,
    joint,
    laterOnCards,
  });
  // The box is drawn once everything it adds up is read; the grid waits for it, so the faces never jump down under it.
  const boxRead = accounts.isSuccess && balances.isSuccess && rates.isSuccess && plansRead && !billRates.isPending && !monthBills.isPending;
  const boxReady = boxRead && box.accounts > 0;
  const figures = box.balanceMinor !== null && box.spendingMinor !== null;

  // Which of the box's rows the grid is filtered to: this visit's only, and only while the grid and its box are drawn.
  const [filter, setFilter] = useState<WalletFilter | null>(null);
  const [billsOpen, setBillsOpen] = useState(false);
  const filtering = boxed && boxReady && figures ? filter : null;
  useEffect(() => {
    if (!boxed) setFilter(null);
  }, [boxed]);
  const openBills = () => {
    setFilter(null);
    setBillsOpen(true);
  };
  /** The money the box counts — a parent's pockets rather than the parent — so its line is drawn from the same money. */
  const countedIds = money.flatMap((account) => {
    const pockets = pocketsOf(account.id, book);
    return pockets.length > 0 ? pockets.map((pocket) => pocket.id) : [account.id];
  });
  /** What moved in and out of that money each day: the ledger's own conversion, so the line needs no rate of its own. */
  const flows = useQuery({
    queryKey: ['wallet-flows', ws.workspaceId, today, countedIds.join(',')],
    // Read only while the box is on screen: an open card's page and a hidden box draw no line.
    enabled: accounts.isSuccess && openId === undefined && boxed,
    queryFn: async () => {
      const { transactions } = await listTransactionsIn(database, ws, { from: daysBefore(today, SPARK_DAYS), to: today });
      const ids = new Set(countedIds);
      return transactions.flatMap((transaction) => {
        const minor = transaction.entries.reduce((sum, entry) => (ids.has(entry.accountId) ? sum + entry.amountBaseMinor : sum), 0);
        return minor === 0 ? [] : [{ on: transaction.occurredOn, minor }];
      });
    },
  });
  const series = flows.data && box.balanceMinor !== null ? balanceSeries({ todayMinor: box.balanceMinor, today, days: SPARK_DAYS, flows: flows.data }) : null;
  const crossed = series ? crossing(series) : null;

  const raised = openId !== undefined ? wallet.find((card) => card.key === openId) : undefined;
  /*
   * Opened from the stack, the way back is the history's own steps, so ✕ and Back are one gesture and the stack is
   * where they land. Reached by a link from elsewhere — an account's row on Net worth — ✕ goes back there, as that
   * page's own ‹ did; opened with nothing behind it (a deep link, a reload), it goes to the stack instead of out of
   * the app. Where the stack was is the history's own index.
   */
  const at = () => (router.history.location.state as { __TSR_index?: number }).__TSR_index ?? 0;
  useEffect(() => {
    if (openId === undefined) stackAt = at();
    if (!watching) {
      watching = true;
      // A page the card opens (its statement) unmounts this one and back remounts it: the stack's place in the history
      // is kept across that, and let go once the reader is anywhere that is not the wallet's or a card's own.
      router.subscribe('onResolved', ({ toLocation }) => {
        if (!/^\/(wallet|cards|accounts)(\/|$)/.test(toLocation.pathname)) stackAt = null;
      });
    }
  });
  const close = () => {
    const now = at();
    if (stackAt !== null && now > stackAt) router.history.go(stackAt - now);
    else if (stackAt === null && router.history.canGoBack()) router.history.back();
    else void navigate({ to: '/wallet' });
  };
  // Opening a card moves focus to its heading, so a reader lands on the card they chose.
  const header = useRef<HTMLDivElement>(null);
  const raisedKey = raised?.key;
  useEffect(() => {
    if (raisedKey) header.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [raisedKey]);

  /*
   * A page for an account or a card the stack does not hold — a deposit, savings kept aside, a pocket — stands on its
   * own, as it always has, as soon as the accounts say so. One the stack does hold waits for the stack, so the card
   * rises out of it rather than a page being drawn and then moved under a card.
   */
  if (openId !== undefined) {
    if (!accounts.isSuccess) return accounts.isError ? <Outlet /> : null;
    if (![...money, ...credit].some((account) => account.id === openId) && !joint.some((card) => card.key === openId)) return <Outlet />;
    if (!raised) return ready ? <Outlet /> : null;
  }

  /*
   * The corners: the View button — a tap steps pile, grid, one at a time — the Points page,
   * then ＋ (the New account page, whose Type row also reaches a credit card), and the card tools the Cards tab had,
   * which wait behind the ⋯.
   */
  const actions: CornerAction[] = [
    // One tap steps to the next view — pile, grid, one at a time, and round again; the glyph is the view in force.
    {
      key: 'view',
      label: `View: ${WALLET_VIEW_LABELS[view]}`,
      glyph: view === 'stack' ? <Layers size={20} aria-hidden /> : view === 'grid' ? <LayoutGrid size={20} aria-hidden /> : <GalleryHorizontal size={20} aria-hidden />,
      run: () => changeWalletView(WALLET_VIEWS[(WALLET_VIEWS.indexOf(view) + 1) % WALLET_VIEWS.length]!),
    },
    // The points programmes the cards earn into: a page of their own, not a list under the cards.
    { key: 'points', label: 'Points', glyph: <Award size={20} aria-hidden />, to: '/cards/points' },
    {
      key: 'add',
      label: 'Add',
      glyph: <Plus size={22} aria-hidden />,
      to: '/accounts/add',
    },
    // The cards put in an order by hand: one list, money and credit cards mixed, read by all three views.
    { key: 'reorder', label: 'Reorder cards', glyph: <ArrowUpDown size={18} aria-hidden />, to: '/wallet/reorder' },
    { key: 'merchants', label: 'Merchants', glyph: <Store size={18} aria-hidden />, to: '/cards/merchants' },
    { key: 'recommend', label: 'Which card?', glyph: <Sparkles size={18} aria-hidden />, to: '/recommend' },
  ];
  /* The raised card's settings: a credit card's — or a debit card's, opened as a card — or the account's own. */
  const settings = cardId !== undefined ? ({ to: '/cards/$cardId/settings', params: { cardId } } as const) : ({ to: '/net-worth/assets/$accountId/settings', params: { accountId: openId ?? '' } } as const);

  return (
    <Screen>
      <div ref={header}>
        {raised ? (
          /*
           * Wallet's bar over an open pass: ✕ on the left, ⚙ on the right, and no title — the raised card is the
           * header. The card's name is still the heading a reader hears.
           */
          <header className="ph-bar-in mb-[14px] flex items-center justify-between gap-3" style={{ paddingTop: 8 }}>
            <CornerButton label="Close" onClick={close}>
              <X size={20} aria-hidden />
            </CornerButton>
            <h1 tabIndex={-1} className="sr-only">
              {raised.name}
            </h1>
            {itemId === undefined ? (
              <CornerButton label="Settings" to={settings.to} params={settings.params}>
                <Settings size={20} aria-hidden />
              </CornerButton>
            ) : (
              // The partner's item has no settings here: they stay on the owner's phone, and its page says so.
              <span aria-hidden className="h-[34px] w-[34px]" />
            )}
          </header>
        ) : (
          <LargeTitle title="Wallet" actions={actions} max={4} />
        )}
      </div>
      {/*
       * Balance, and the two numbers it is made of, as one block: the figure, the month behind it, and the rows that
       * are its legend. The goals are already subtracted in the first row. The grid's alone.
       */}
      {!raised && boxed && boxReady &&
        (box.balanceMinor !== null && box.spendingMinor !== null ? (
          <Panel className="space-y-3" testId="wallet-balance">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Balance</p>
              {/* One line, whatever the amount is: a figure that wraps reads as two figures where there is one. */}
              <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em]">
                {box.estimated && <span className="text-[var(--ph-ink-3)]">≈ </span>}
                {heroFigure(box.balanceMinor, ws.baseCurrency).text}
              </p>
            </div>
            {series && <BalanceSpark series={series} currency={ws.baseCurrency} crossing={crossed} className="pt-1" />}
            <div className="border-t-[0.5px] border-[var(--ph-hair)] pt-[5px]">
              <SpendRow
                colour="var(--ph-up)"
                label="Spending money"
                value={box.spendingMinor}
                currency={ws.baseCurrency}
                pressed={filtering === 'spending'}
                tint="var(--ph-up-panel)"
                dimmed={filtering !== null && filtering !== 'spending'}
                onClick={() => setFilter((current) => toggleFilter(current, 'spending'))}
                testId="wallet-spending-row"
              />
              <Hair />
              <SpendRow
                colour="var(--ph-alarm)"
                label="Outstanding on cards"
                value={-(box.cardsMinor ?? 0)}
                currency={ws.baseCurrency}
                pressed={filtering === 'cards'}
                tint="var(--ph-alarm-panel)"
                dimmed={filtering !== null && filtering !== 'cards'}
                onClick={() => setFilter((current) => toggleFilter(current, 'cards'))}
                testId="wallet-cards-row"
              />
              {box.bills.length > 0 && (
                <>
                  <Hair />
                  <SpendRow
                    colour="var(--ph-warn)"
                    label="Bills still to pay"
                    value={-(box.billsMinor ?? 0)}
                    currency={ws.baseCurrency}
                    dimmed={filtering !== null}
                    chevron
                    onClick={openBills}
                    testId="wallet-bills-row"
                  />
                </>
              )}
            </div>
          </Panel>
        ) : (
          <Panel header="Balance" testId="wallet-balance">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {box.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each card below is exact.
            </p>
          </Panel>
        ))}
      {billsOpen && !raised && boxed && (
        <BillsToPaySheet bills={box.bills} month={month} totalMinor={box.billsMinor ?? 0} currency={ws.baseCurrency} accounts={everything} onClose={() => setBillsOpen(false)} />
      )}
      {!raised && ready && wallet.length === 0 && (
        <Empty>
          Nothing to spend from yet. Add money or a credit card with ＋. Savings, deposits and loans are on{' '}
          <Link to="/net-worth" className="underline">
            Net worth
          </Link>
          .
        </Empty>
      )}
      {/*
       * The cards, laid out as this device chose. An open card is always the stack's raised card over its page,
       * alone, with no pile over its page: the grid and the carousel are ways of reading the cards at rest, and
       * come back as soon as the card is put down.
       */}
      {ready && wallet.length > 0 && (raised || view === 'stack') && (
        <CardStack
          label="Cards"
          // An open card stands alone, from whichever view it was opened: the pile left over its page was clutter.
          cards={raised ? [raised] : wallet}
          raised={raised?.key ?? null}
          onClose={close}
          onOpen={(key) => void navigate({ to: '/accounts/$accountId', params: { accountId: key } })}
        >
          <Outlet />
        </CardStack>
      )}
      {ready && boxRead && wallet.length > 0 && !raised && view === 'grid' && (
        <>
          {/* Under a filter, what the grid holds now and the way back to every card. */}
          {filtering && (
            <div className="flex items-baseline justify-between gap-3 px-[4px] pb-[6px]" data-testid="wallet-filter">
              <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">
                {FILTER_LABELS[filtering]} · {filteredCards(wallet, filtering, moneySet, creditSet).length}
              </h2>
              <button type="button" onClick={() => setFilter(null)} className="ph-focus ph-tap text-[15px] leading-[20px] text-[var(--ph-tint)]">
                Show all
              </button>
            </div>
          )}
          <WalletGrid cards={filteredCards(wallet, filtering, moneySet, creditSet)} />
        </>
      )}
      {ready && wallet.length > 0 && !raised && view === 'carousel' && <WalletCarousel cards={wallet} accounts={everything} />}
      {/* A bank account's debit card rewards are set up from the account's Settings (`DebitRewardsGroup`), not from here. */}
      {/*
       * With separate tax IDs, the other members' shared items (joint-net-worth §8.2): listed under "Andi's, shared",
       * to see and open, and counted in nothing on this page. With one tax ID they are the household's Net worth.
       */}
      {!raised &&
        sharedGroups.map((section) => (
          <InsetGroup key={section.owner} wide header={section.title}>
            {section.items.map((item) => (
              <InsetRow
                key={item.itemId}
                /* The kind's drawing, ringed in its owner's colour, as the same item wears it on Net worth (D12). */
                icon={<item.tile size={16} aria-hidden />}
                iconRing={section.ring ?? undefined}
                // Owned together (2026-11-13): the two-person mark, as the item wears it on Net worth.
                iconMark={together(item.itemId)}
                title={
                  <>
                    {item.name}
                    <span className="sr-only">, {section.ownerName}'s</span>
                  </>
                }
                subtitle={item.kindLabel}
                value={<Money minor={item.minor} currency={item.currency} />}
                valueTone="ink"
                to="/net-worth/shared/$itemId"
                params={{ itemId: item.itemId }}
                testId={`shared-item-${item.itemId}`}
              />
            ))}
          </InsetGroup>
        ))}
    </Screen>
  );
}
