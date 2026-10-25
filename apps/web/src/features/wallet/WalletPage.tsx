import { formatMinor, sumToBase } from '@expanses/core';
import { listTransactionsIn } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams, useRouter } from '@tanstack/react-router';
import { ArrowUpDown, Award, GalleryHorizontal, LayoutGrid, Layers, Plus, Settings, Sparkles, Store, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { cx, Empty, Money } from '../../ui';
import { CardStack, CornerButton, type CornerAction, heroFigure, InsetGroup, InsetRow, LargeTitle, Panel } from '../../ui/native';
import { BalanceSpark } from '../accounts/BalanceSpark';
import { balanceSeries, crossing, daysBefore } from '../accounts/balance-series';
import { SPENDABLE_KINDS, freeToSpend, moneySummary, pocketsOf } from '../accounts/pockets';
import { sharedSections } from '../accounts/shared-accounts';
import { useSetAsideViews } from '../goals/queries';
import { owedMinor } from '../networth/debt-rows';
import { useSharedNetWorth } from '../networth/queries';
import { useWalletCards } from './useWalletCards';
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

/** How many days of history the Balance box's line is drawn over. */
const SPARK_DAYS = 30;

/**
 * One share of the Balance box: a dot in the line's own colour, what it is called, and its figure on the right. The
 * legend and the picture are one thing, so the dot's colour is the line's colour and never a colour of its own.
 */
function SpendRow({ colour, label, value, currency, separator = false }: { colour: string; label: string; value: number; currency: string; separator?: boolean }) {
  return (
    <div className={cx('flex items-center justify-between gap-[10px]', separator && 'mt-3 border-t-[0.5px] border-[var(--ph-hair)] pt-3')}>
      <span className="flex min-w-0 items-center gap-[7px]">
        <span aria-hidden className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: colour }} />
        <span className="truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{label}</span>
      </span>
      <span className="shrink-0 tabular text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{formatMinor(value, currency)}</span>
    </div>
  );
}

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
  const { cardId, accountId } = useParams({ strict: false }) as { cardId?: string; accountId?: string };
  const openId = cardId ?? accountId;
  // Wallet's cards, drawn and in order (`useWalletCards`), and the money they were read from.
  const { accounts, balances, everything, all, book, money, credit, rates, held, today, cards: wallet, ready } = useWalletCards();
  const owed = useSetAsideViews();
  const shared = useSharedNetWorth().data;
  const sharedGroups = shared ? sharedSections(shared.group.mode, shared.group.members, shared.names, shared.items) : [];

  // How the cards are laid out on this device: the pile, a grid, or one at a time (`wallet-view`).
  const view = useWalletView();
  // The pile and the carousel are the cards and nothing else; the grid always has the Balance box over it.
  const boxed = view === 'grid';

  /*
   * The Balance box: money kept for spending, less what goals have claimed of it, less what the credit cards owe —
   * every card's whole balance, billed or not, because that money is already spent. Loans and money owed to people
   * are not here any more: they are read against a year's schedule on Net worth's Liabilities, not as this month's
   * claim on the money in a pocket. A rate short and there is no figure; the missing currency is named instead.
   */
  const spendable = moneySummary(book, all, ws.baseCurrency, held, SPENDABLE_KINDS);
  const counted = new Set(book.filter((a) => a.kind === 'asset' && SPENDABLE_KINDS.has(a.subtype)).map((a) => a.id));
  const promiseAmounts = Object.values(owed.data ?? {})
    .filter((row) => counted.has(row.accountId))
    .map((row) => ({ minor: row.setAsideMinor, currency: row.currency }));
  const promised = sumToBase({ amounts: promiseAmounts, baseCurrency: ws.baseCurrency, ratesToBase: held });
  const askedAmounts = credit.flatMap((card) => {
    const owes = owedMinor(all, card.id);
    return owes > 0 ? [{ minor: owes, currency: card.currency ?? ws.baseCurrency }] : [];
  });
  const asked = sumToBase({ amounts: askedAmounts, baseCurrency: ws.baseCurrency, ratesToBase: held });
  const unclaimed = freeToSpend(spendable, promised, { totalMinor: 0, missing: [] });
  const free = freeToSpend(spendable, promised, asked);
  const estimated = spendable.converted || [...promiseAmounts, ...askedAmounts].some((amount) => amount.currency !== ws.baseCurrency);
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
  const series = flows.data && free.freeMinor !== null ? balanceSeries({ todayMinor: free.freeMinor, today, days: SPARK_DAYS, flows: flows.data }) : null;
  const crossed = series ? crossing(series) : null;

  const raised = openId !== undefined ? wallet.find((card) => card.key === openId) : undefined;
  /*
   * Opened from the stack, the way back is the history's own steps, so ✕ and Back are one gesture and the stack is
   * where they land. Reached by a link from elsewhere — an account's row on Net worth — ✕ goes back there, as that
   * page's own ‹ did; opened with nothing behind it (a deep link, a reload), it goes to the stack instead of out of
   * the app. Where the stack was is the history's own index.
   */
  const at = () => (router.history.location.state as { __TSR_index?: number }).__TSR_index ?? 0;
  const stackAt = useRef<number | null>(null);
  useEffect(() => {
    if (openId === undefined) stackAt.current = at();
  });
  const close = () => {
    const now = at();
    if (stackAt.current !== null && now > stackAt.current) router.history.go(stackAt.current - now);
    else if (stackAt.current === null && router.history.canGoBack()) router.history.back();
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
    if (![...money, ...credit].some((account) => account.id === openId)) return <Outlet />;
    if (!raised) return ready ? <Outlet /> : null;
  }

  /*
   * The corners: the View button — a tap steps pile, grid, one at a time — the Points page,
   * then ＋ (money to spend from, or a credit card, each through its own door), and the card tools the Cards tab had,
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
      menu: [
        { key: 'money', label: 'Money account', to: '/accounts/new' },
        { key: 'card', label: 'Credit card', to: '/debts/new' },
      ],
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
            <CornerButton label="Settings" to={settings.to} params={settings.params}>
              <Settings size={20} aria-hidden />
            </CornerButton>
          </header>
        ) : (
          <LargeTitle title="Wallet" actions={actions} max={4} />
        )}
      </div>
      {/*
       * Balance, and the two numbers it is made of, as one block: the figure, the month behind it, and the rows that
       * are its legend. The goals are already subtracted in the first row. The grid's alone.
       */}
      {!raised && boxed && accounts.isSuccess && balances.isSuccess && rates.isSuccess && spendable.accounts > 0 &&
        (free.freeMinor !== null && unclaimed.freeMinor !== null ? (
          <Panel className="space-y-3" testId="wallet-balance">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Balance</p>
              {/* One line, whatever the amount is: a figure that wraps reads as two figures where there is one. */}
              <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em]">
                {estimated && <span className="text-[var(--ph-ink-3)]">≈ </span>}
                {heroFigure(free.freeMinor, ws.baseCurrency).text}
              </p>
            </div>
            {series && <BalanceSpark series={series} currency={ws.baseCurrency} crossing={crossed} className="pt-1" />}
            <div className="border-t-[0.5px] border-[var(--ph-hair)] pt-3">
              <SpendRow colour="var(--ph-tint)" label="Spending money" value={unclaimed.freeMinor} currency={ws.baseCurrency} />
              <SpendRow separator colour="var(--ph-alarm)" label="Owed on cards" value={-(free.dueMinor ?? 0)} currency={ws.baseCurrency} />
            </div>
          </Panel>
        ) : (
          <Panel header="Balance" testId="wallet-balance">
            <p className="text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
              No {free.missing.join(', ')} rate yet, so what is left to spend cannot be worked out. Each card below is exact.
            </p>
          </Panel>
        ))}
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
       * whichever layout it was opened from: the grid and the carousel are ways of reading the cards at rest, and
       * come back as soon as the card is put down.
       */}
      {ready && wallet.length > 0 && (raised || view === 'stack') && (
        <CardStack
          label="Cards"
          cards={wallet}
          raised={raised?.key ?? null}
          onClose={close}
          onOpen={(key) => void navigate({ to: '/accounts/$accountId', params: { accountId: key } })}
        >
          <Outlet />
        </CardStack>
      )}
      {ready && wallet.length > 0 && !raised && view === 'grid' && <WalletGrid cards={wallet} />}
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
                iconRing={item.ring ?? undefined}
                title={item.name}
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
