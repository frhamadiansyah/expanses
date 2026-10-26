import { type AssetKind, assetItemOfCode, CASH_ITEMS, formatMinor, formatUnits, fundPlaceMatches, isoDate, lastNMonths, minorToMajorString, monthOf, isIdxListing, presetFor, type UnitKind } from '@expanses/core';
import { type AssetValueRow, couponOn, deleteTrade, deleteValuation, type ValuationWithNote, setSecurityPriceChoice, switchOf, type TradeRow } from '@expanses/db';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowDownLeft, ArrowLeftRight, ChartLine, Info, Minus, MoreVertical, Plus, RotateCw, Settings, SquarePen } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useBalances, useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import {
  ActionButtons,
  approxLine,
  type CornerAction,
  type GroupChild,
  InsetGroup,
  InsetRow,
  Panel,
  PushedTitle,
  ReadOnlyRow,
  ROW_PAD_X,
  ROW_PAD_Y,
  type RoundAction,
  SCREEN,
  SelectRow,
  SubmitRow,
  TextRow,
} from '../../ui/native';
import { AccountPage } from '../accounts/AccountPage';
import { BalanceCard } from '../accounts/BalanceCard';
import type { DayBalance } from '../accounts/balance-series';
import { LINE_DAYS, useHeldRates, useOpenings } from '../accounts/queries';
import { useGoalLinks, useGoals } from '../goals/queries';
import { useLoans } from '../loans/queries';
import { acquiredLabel } from './acquired';
import { dayLabel, estimatedTiles, gainPill, heroLine, monthEnd, priceLine, pricedDaySeries, pricedTiles, type Tile, type TradeLine, tradeLine } from './asset-page';
import { Sheet as SheetFrame } from '../../app/Sheet';
import { institutionChoices } from './institutions';
import { ListedTradeSheet } from './ListedTradeSheet';
import { FundTradeSheet } from './FundTradeSheet';
import { SwitchSheet } from './SwitchSheet';
import { GoldChartSheet } from './GoldChartSheet';
import { GoldTradeSheet } from './GoldTradeSheet';
import { ASSET_TILES } from '../ownables/catalogue-view';
import { SuggestRow } from '../ownables/CashAccountForm';
import { PriceSheet, PriceSourceSheet, TradeActionsSheet, TradeSheet, ValueSheet } from './AssetSheets';
import { ReinvestedSheet, TradeGoalsSheet } from './TradeTagSheets';
import { BASIS_LABELS, UNIT_LABELS } from './labels';
import { useAcquiredDates, useAssetProfile, useAssetProfiles, useAssetValues, useBondCoupons, useMonthEndValues, usePositions, usePrices, useTrades, useValuations } from './queries';
import { useStockAndBroker } from './StockAndBroker';
import { draftFromTrade, type TradeDraft } from './trade-form';
import { useGoldPriceChoice, useWorldGoldPrice } from './world-gold';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';
import { CHOICE_LABELS, listedChoiceOf, listedSourceOptions, SOURCE_LABELS } from '../prices/price-sources';
import { useSecurityPriceChoices } from '../prices/queries';
import { useYahooClose } from '../prices/yahoo';

/** The kinds of money account: their own page is the account page, whichever list they were opened from. */
const CASH_SUBTYPES = new Set<string>(CASH_ITEMS.map((item) => item.id));

/** The kinds a broker keeps: the Kept at row is theirs. Only a listed share has a ticker to give it. */
const BROKER_KINDS: readonly AssetKind[] = ['stock', 'fund', 'bond'];

/** A list longer than this folds, with See all to open the rest. */
const FOLDED = 5;

/** What the price tile is called, by what one unit of the thing is. */
const PRICE_TILE: Record<UnitKind, string> = { grams: 'Buyback today', shares: 'Close today', units: 'Price today', face: 'Price today' };

/** The word for a payment a holding makes: a share's dividend, a bond's coupon. */
const incomeWordOf = (kind: AssetKind | null) => (kind === 'stock' ? 'Dividend' : kind === 'bond' ? 'Coupon' : 'Income');

/** The Broker row's choice that opens a broker by name rather than picking one. */
const NEW_BROKER = 'new-broker';

/** A broker not in the app yet, named and opened where a holding is kept. */
function NewBrokerSheet({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  return (
    <SheetFrame grouped title="New broker" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <InsetGroup footer="Opened as a broker's cash account, as Add a holding opens one. Its RDN bank is named in its Settings.">
          <TextRow label="Broker name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Required" required />
        </InsetGroup>
        <InsetGroup>
          <SubmitRow label="Add broker" disabled={!name.trim()} />
        </InsetGroup>
      </form>
    </SheetFrame>
  );
}

type Sheet =
  | { kind: 'price' }
  | { kind: 'value' }
  | { kind: 'estimate'; valuation: ValuationWithNote }
  | { kind: 'edit-value'; valuation: ValuationWithNote }
  | { kind: 'listed-source' }
  | { kind: 'listed-trade'; trade: 'buy' | 'sell' }
  | { kind: 'fund-trade'; trade: 'buy' | 'sell' }
  | { kind: 'gold-trade'; trade: 'buy' | 'sell' }
  | { kind: 'gold-chart' }
  | { kind: 'trade'; title: string; initial: Partial<TradeDraft>; editing: TradeRow | null }
  | { kind: 'row'; trade: TradeRow; title: string }
  | { kind: 'goals'; trade: TradeRow }
  | { kind: 'reinvested'; trade: TradeRow }
  | { kind: 'switch'; editing: { out: TradeRow; into: TradeRow } | null }
  | { kind: 'new-broker' };

/**
 * `/net-worth/assets/$accountId` — one page for everything owned that is not money: priced things (gold, shares, a
 * fund, a bond) and things valued by an estimate (a house, a car, a laptop).
 *
 * The frame is the account page's: the round ‹ back to Assets, the name centred, one ⋯. Then what it is worth now
 * with what it has made, what can be done with it, four labelled figures, where the price came from, the year's
 * chart, the buys or the values it has had, and the plain facts. Every form opens in a sheet, so none is left open
 * on the page.
 *
 * A money account reached here — a set-aside warning on the overview links to this address — is drawn by the account
 * page, which is where every money account's page now lives; the ledger-balance version of this page was retired.
 */
export function AssetDetailPage() {
  const params = useParams({ strict: false }) as { accountId?: string };
  const accountId = params.accountId ?? '';
  const accounts = useAccounts();
  const values = useAssetValues();
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  if (!accounts.isSuccess) return <div className={SCREEN}>Loading…</div>;
  if (account && CASH_SUBTYPES.has(account.subtype)) return <AccountPage />;
  const value = values.data?.find((row) => row.accountId === accountId);
  if (!value) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Asset" back="Assets" backTo="/net-worth/assets" />
        <ErrorBox error={values.error} />
        {!values.isPending && <Empty>That asset is not in this workspace.</Empty>}
      </div>
    );
  }
  // Keyed, so moving from one asset to another starts the page's own state (a sheet, an error) afresh.
  return <AssetBody key={accountId} value={value} />;
}

function AssetBody({ value }: { value: AssetValueRow }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const { accountId, currency } = value;
  const months = lastNMonths(monthOf(isoDate()), 12);

  const profile = useAssetProfile(accountId);
  const positions = usePositions();
  const couponTerms = useBondCoupons();
  const prices = usePrices(accountId);
  const valuations = useValuations(accountId);
  const lastValued = (valuations.data ?? []).filter((row) => row.basis !== 'njop').reduce<string | null>((last, row) => (last === null || row.asOf > last ? row.asOf : last), null);
  const trades = useTrades(accountId);
  const history = useMonthEndValues(accountId, months);
  const goalLinks = useGoalLinks();
  const goals = useGoals();
  const loans = useLoans();
  const balances = useBalances();
  const openings = useOpenings([accountId]);
  const acquiredDates = useAcquiredDates();
  // When it was acquired, as precisely as that was typed; before 0074 every asset was typed to the day it opened.
  const openedOn = openings.data?.[accountId]?.occurredOn;
  const acquired = acquiredDates.data?.[accountId] ?? (openedOn ? { on: openedOn, precision: 'day' as const } : null);
  const held = useHeldRates(currency === ws.baseCurrency ? [] : [currency]);
  const stock = useStockAndBroker(accountId);
  const profiles = useAssetProfiles();
  const everyAccount = useAccounts().data ?? [];
  const brokerId = stock.link?.brokerAccountId ?? null;
  const rdnBank = brokerId ? (profiles.data ?? []).find((row) => row.accountId === brokerId)?.coretaxFields.inst?.trim() || null : null;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<unknown>(null);
  // What the last change to a recorded trade did, said over the page: a goal kept, a payment marked, a trade deleted.
  const [notice, setNotice] = useState('');
  const [all, setAll] = useState(false);
  // An Institution being typed; null once it is saved, when the row reads the saved name again.
  const [placeDraft, setPlaceDraft] = useState<string | null>(null);

  const kind = profile.data?.assetKind ?? null;
  const unitKind = profile.data?.unitKind ?? null;
  const priced = value.mode === 'market';
  const estimated = value.mode === 'snapshot';
  // A fund tracked by money (spec 2026-10-19-fund-by-amount): buys and sells by amount, its value typed from the app.
  const byMoney = value.mode === 'amount';
  const position = positions.data?.[accountId];
  const unitsMicro = position?.unitsMicro ?? 0;
  /*
   * A bond's coupon terms (0081): the next payment on the bond's page, and the figures the Coupon button opens with —
   * on the par held now, before and after the tax withheld.
   */
  const coupon = kind === 'bond' ? (couponTerms.data?.[accountId] ?? null) : null;
  const matured = coupon !== null && coupon.maturesOn !== null && coupon.nextOn > coupon.maturesOn;
  const nextCoupon = coupon && !matured ? couponOn(coupon, unitsMicro, currency) : null;
  // A linked holding counts in the security's lots; one of its own, in the lot its settings say.
  const lotSize = stock.security?.lotSize ?? profile.data?.lotSize ?? null;
  const latestPrice = prices.data?.[0] ?? null;
  // Gold counted in grams follows the world price unless its owner chose to type every price.
  const gold = priced && kind === 'gold' && unitKind === 'grams';
  const choiceQuery = useGoldPriceChoice(accountId, gold);
  const choice = gold ? (choiceQuery.data ?? null) : null;
  const world = useWorldGoldPrice({ accountId, currency, choice, latest: latestPrice, ready: prices.isSuccess && choiceQuery.isSuccess });
  // A listed share with a ticker follows its security's choice: Yahoo Finance's close, IDX's daily file, or typing.
  const listedSecurity = priced && stock.security?.ticker ? stock.security : null;
  const listedChoices = useSecurityPriceChoices();
  const listedChoice = listedSecurity && listedChoices.isSuccess ? listedChoiceOf(listedSecurity, listedChoices.data[listedSecurity.id] ?? null) : null;
  const yahoo = useYahooClose({ security: listedSecurity, choice: listedChoice, latest: latestPrice, ready: prices.isSuccess && listedChoices.isSuccess });
  // The price this page can fetch, if any: gold's world price or a share's Yahoo close, each with its ↻.
  const fetcher =
    choice === 'world'
      ? { label: 'Fetch today’s world price', state: world.state, run: world.retry }
      : listedChoice === 'yahoo'
        ? { label: 'Fetch the latest close', state: yahoo.state, run: yahoo.retry }
        : null;
  // A share or a fund whose price has gone a few days without an update says so, with the way to Update prices.
  const latestValuation = (valuations.data ?? []).find((row) => row.basis !== 'njop' && row.asOf === value.asOf) ?? null;
  const kindLabel = assetItemOfCode(value.coretaxCode)?.label ?? (kind ? presetFor(kind).label : 'Asset');
  const boughtWith = (loans.data ?? []).find((loan) => loan.assetAccountId === accountId && loan.status === 'open');
  const owedMinor = boughtWith ? Math.abs(balances.data?.[boughtWith.accountId] ?? 0) : 0;
  const forGoals = (goalLinks.data ?? []).filter((link) => link.accountId === accountId && link.kind === 'tagged');
  // The other funds it can be the same fund as: every other fund holding, wherever it is held.
  // Where a fund or bond is held: an institution's name, kept as its Nama institusi (0082).
  const institutions = institutionChoices(everyAccount, profiles.data ?? []);
  const heldName = profile.data?.coretaxFields.inst?.trim() ?? '';
  const holding = { accountId, name: value.name, currency, byMoney };
  const nameOf = (id: string) => everyAccount.find((row) => row.id === id)?.name ?? 'another fund';
  const unitLabel = unitKind ? UNIT_LABELS[unitKind] : 'units';
  const gain = gainPill(value.valueMinor, value.costMinor, currency);
  const line = heroLine({
    kindLabel,
    mode: value.mode,
    unitKind,
    unitsMicro,
    lotSize,
    currency,
    valuation: estimated && value.source === 'valuation' && latestValuation ? { basis: latestValuation.basis, asOf: latestValuation.asOf } : null,
  });

  // The line under the figure: a priced thing day by day over the month, an estimated one month by month over the
  // year — an estimate moves in steps, so a month is the finest it can say.
  const today = isoDate();
  const series: DayBalance[] | null = priced
    ? trades.data && prices.data
      ? pricedDaySeries(trades.data, prices.data, { accountId, currency, today, days: LINE_DAYS })
      : null
    : history.data
      ? months.map((month, index) => ({ on: monthEnd(month) < today ? monthEnd(month) : today, minor: history.data[index] ?? 0 }))
      : null;

  // Where the price came from and the day it is for ("Typed · 24 Sep 2026"): behind the price figure's ⓘ rather than
  // a line of its own, since it only matters when someone asks how current the figure is.
  const saidPrice = priced ? priceLine({ latest: latestPrice, fetches: fetcher !== null, failed: fetcher?.state === 'failed', today: isoDate() }) : '';
  // A close from Yahoo or IDX's file is the last session's, not today's.
  const outsideClose = latestPrice?.source === 'yahoo' || latestPrice?.source === 'idx';
  const priceLabel = gold && latestPrice?.source === 'world' ? 'World price' : gold ? 'Typed price' : outsideClose ? 'Last close' : unitKind ? PRICE_TILE[unitKind] : 'Price today';
  const pricedTileList: Tile[] = priced
    ? pricedTiles({
        unitKind,
        unitsMicro,
        costMinor: value.costMinor,
        lotSize,
        currency,
        priceMicro: latestPrice?.priceMicro ?? null,
        priceLabel,
        ...(gold && latestPrice?.source === 'world'
          ? { priceTag: { info: 'Not buyback: this is the world spot price. A dealer usually buys gold back a few percent below it.' } }
          : latestPrice?.source === 'yahoo'
            ? { priceTag: { info: 'Delayed; the last close, not a live price.' } }
            : {}),
      })
    : [];
  const tiles: Tile[] = priced
    ? pricedTileList.map((tile) =>
        tile.label === priceLabel
          ? { ...tile, info: tile.info ? `${saidPrice}. ${tile.info}` : saidPrice }
          : tile,
      )
    : byMoney
      ? [{ label: 'Money in', value: formatMinor(value.costMinor, currency), info: 'Money put in and not taken out yet. The value above minus this is the gain.' }]
      : estimated
      ? estimatedTiles({
          costMinor: value.costMinor,
          acquired,
          currency,
          loan: boughtWith ? { valueMinor: value.valueMinor, owedMinor } : null,
        })
      : [];

  const trade = (title: string, initial: Partial<TradeDraft>) => () => setSheet({ kind: 'trade', title, initial, editing: null });
  // A share listed on IDX buys and sells in its own sheet: price on IDX's tick, whole lots, the broker's fee.
  const idxShare = listedSecurity && isIdxListing(listedSecurity) ? listedSecurity : null;
  // A mutual fund counted in units buys and sells by amount in its own sheet: the units come from the NAV.
  const fundHolding = byMoney || (priced && kind === 'fund' && unitKind === 'units' && !idxShare);
  // Gold counted in grams buys and sells by weight and the receipt's total, with the brand's bar sizes to hand.
  const goldHolding = priced && unitKind === 'grams' && !idxShare;
  const buyOrSell = (kind: 'buy' | 'sell', title: string) =>
    idxShare
      ? () => setSheet({ kind: 'listed-trade', trade: kind })
      : fundHolding
        ? () => setSheet({ kind: 'fund-trade', trade: kind })
        : goldHolding
          ? () => setSheet({ kind: 'gold-trade', trade: kind })
          : trade(title, { kind });
  // The kind's own drawing, as the Assets list draws it, for the short sheets' holding line.
  const KindGlyph = ASSET_TILES[assetItemOfCode(value.coretaxCode)?.id ?? kind ?? ''] ?? ASSET_TILES.fund!;
  const actions: RoundAction[] = priced
    ? [
        { key: 'buy', label: 'Buy', glyph: <Plus size={20} aria-hidden />, run: buyOrSell('buy', 'Buy') },
        { key: 'sell', label: 'Sell', glyph: <Minus size={20} aria-hidden />, run: buyOrSell('sell', 'Sell') },
        // Gold pays nothing while it is held, so its third button is the world price's chart with its buys and sells on
        // it; a share, a fund and a bond each pay in their own word.
        ...(kind === 'gold'
          ? unitKind === 'grams'
            ? [{ key: 'chart', label: 'Chart', glyph: <ChartLine size={20} aria-hidden />, run: () => setSheet({ kind: 'gold-chart' }) }]
            : []
          : [
              {
                key: 'income',
                label: incomeWordOf(kind),
                glyph: <ArrowDownLeft size={20} aria-hidden />,
                // A bond with coupon terms opens on its next coupon: the day it falls, before tax, the tax, and where it lands.
                run: trade(
                  incomeWordOf(kind),
                  coupon && nextCoupon
                    ? {
                        kind: 'income',
                        occurredOn: coupon.nextOn <= today ? coupon.nextOn : today,
                        gross: minorToMajorString(nextCoupon.grossMinor, currency),
                        tax: minorToMajorString(nextCoupon.taxMinor, currency),
                        cashAccountId: coupon.cashAccountId ?? '',
                      }
                    : { kind: 'income' },
                ),
              },
            ]),
        { key: 'price', label: 'Price', glyph: <SquarePen size={20} aria-hidden />, run: () => setSheet({ kind: 'price' }) },
      ]
    : byMoney
      ? [
          { key: 'buy', label: 'Buy', glyph: <Plus size={20} aria-hidden />, run: buyOrSell('buy', 'Buy') },
          { key: 'sell', label: 'Sell', glyph: <Minus size={20} aria-hidden />, run: buyOrSell('sell', 'Sell') },
          // Money moved straight into another fund tracked by money, no bank account between them — in the base currency
          // for now, where cost needs no second, base figure carried with it.
          ...(currency === ws.baseCurrency
            ? [{ key: 'switch', label: 'Switch', glyph: <ArrowLeftRight size={20} aria-hidden />, run: () => setSheet({ kind: 'switch', editing: null }) }]
            : []),
          { key: 'value', label: 'Value', glyph: <SquarePen size={20} aria-hidden />, run: () => setSheet({ kind: 'value' }) },
        ]
    // A thing valued by an estimate (land, a house, a car) has one button only, so it has none: its value is updated
    // from its Settings.
    : [];

  /*
   * Arrived with something to do (`?do=buy` and the rest): the same sheet the round button opens, once the holding is
   * known well enough to choose it — a listed share's own sheet, a fund's, gold's, or the full form. Buy & sell's four
   * buttons handed a holding over this way; the address still answers a link that asks. The request is taken out of
   * the address as it is answered, so Back and a reload do not open it again.
   */
  const { do: arriving } = useSearch({ strict: false }) as { do?: 'buy' | 'sell' | 'income' | 'units' };
  const known = profile.isSuccess && stock.ready && couponTerms.isSuccess;
  useEffect(() => {
    if (!arriving || !known) return;
    const action =
      arriving === 'units'
        ? trade('Units', { kind: 'unit_change' })
        : actions.find((row) => row.key === arriving)?.run ?? (arriving === 'income' ? trade(incomeWordOf(kind), { kind: 'income' }) : buyOrSell(arriving, arriving === 'buy' ? 'Buy' : 'Sell'));
    action?.();
    void navigate({ to: '/net-worth/assets/$accountId', params: { accountId }, search: {}, replace: true });
    // Once per arrival: what it opens depends on the holding, read at the moment it became known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriving, known]);

  async function removeTrade(row: TradeRow) {
    setSheet(null);
    // A switch goes as one: both funds' sides, and the money is back where it was.
    const question = row.switchedWith
      ? `Delete this switch? It goes from both funds, and the money is back in ${row.kind === 'sell' ? 'this fund' : nameOf(row.switchedWith.accountId)}.`
      : 'Delete this trade? Later sells are worked out again at the new average cost.';
    if (!window.confirm(question)) return;
    setError(null);
    try {
      const result = await deleteTrade(database, ws, row.id);
      await invalidate();
      setNotice(result.recalculatedSells.length ? `Removed. ${result.recalculatedSells.length} later sells were worked out again.` : 'Removed.');
    } catch (e) {
      setError(e);
    }
  }

  /** Takes one estimate back after asking; the value falls back to the one before it, else the original cost. */
  async function removeValuation(row: ValuationWithNote) {
    if (!window.confirm('Delete this value? The one before it counts again, else the original cost.')) return;
    setError(null);
    try {
      await deleteValuation(database, ws, row.id);
      await invalidate();
      setSheet(null);
      setNotice('Removed.');
    } catch (e) {
      setSheet(null);
      setError(e);
    }
  }

  /** Changes a switch from either of its funds: the sheet opens on the fund the money left, both sides in it. */
  async function editSwitch(row: TradeRow) {
    setError(null);
    try {
      const pair = await switchOf(database, ws, row.id);
      setSheet(pair ? { kind: 'switch', editing: pair } : null);
    } catch (e) {
      setError(e);
    }
  }

  // The goal a recorded buy or sell counts toward, as its ⋮ says it: one goal by name, a split by how many.
  const goalSaid = (row: TradeRow) =>
    row.goalParts?.length
      ? `${row.goalParts.length} goals`
      : row.goalId
        ? ((goals.data ?? []).find((goal) => goal.id === row.goalId)?.name ?? 'A goal')
        : 'No goal';

  // Settings is the one way on from here: its name, when it was acquired, its tax details, and Archive and Delete at
  // the foot — so the corner is that gear alone rather than a menu holding Archive a second time.
  const menu: CornerAction[] = [
    { key: 'settings', label: 'Settings', glyph: <Settings size={20} aria-hidden />, to: '/net-worth/assets/$accountId/settings', params: { accountId } },
  ];


  const lines: { key: string; line: TradeLine; row: TradeRow | null; valuation?: ValuationWithNote }[] = priced
    ? [...(trades.data ?? [])].reverse().map((row) => ({
        key: row.id,
        row,
        line: tradeLine(row, { unitKind, lotSize, currency, priceMicro: latestPrice?.priceMicro ?? null, incomeWord: incomeWordOf(kind) }),
      }))
    : byMoney
      ? [
          // Buys and sells only, newest first: money moved. The values typed draw the chart and the hero; a value updated
          // every day would bury them here (owner, 23 Oct), so the day it was last set sits under Held at instead.
          ...[
            ...(trades.data ?? [])
              .filter((row) => row.kind === 'buy' || row.kind === 'sell')
              .map((row) => ({
                on: row.occurredOn,
                key: row.id,
                row,
                line: {
                  // A switch names the other fund: "Switched out · 23 Oct 2026 · into Bond Fund".
                  title: row.switchedWith ? (row.kind === 'buy' ? 'Switched in' : 'Switched out') : row.kind === 'buy' ? 'Bought' : 'Sold',
                  subtitle: row.switchedWith
                    ? `${dayLabel(row.occurredOn)} · ${row.kind === 'buy' ? 'from' : 'into'} ${nameOf(row.switchedWith.accountId)}`
                    : dayLabel(row.occurredOn),
                  value: `${row.kind === 'buy' ? '+' : '−'}${formatMinor(row.grossMinor, currency)}`,
                  note: null,
                  tone: 'quiet' as const,
                },
              })),
          ]
            .sort((a, b) => b.on.localeCompare(a.on))
            .map(({ key, row, line }) => ({ key, row, line })),
        ]
    : estimated
      ? [
          ...(valuations.data ?? []).map((row) => ({
            key: row.id,
            row: null,
            valuation: row,
            line: {
              title: BASIS_LABELS[row.basis] ?? row.basis,
              subtitle: [dayLabel(row.asOf), row.note].filter(Boolean).join(' · '),
              value: formatMinor(row.valueMinor, currency),
              note: null,
              tone: 'quiet' as const,
            },
          })),
          // What was paid is where the history starts, when it is known.
          ...(value.costMinor > 0
            ? [
                {
                  key: 'bought',
                  row: null,
                  line: {
                    title: 'Original cost',
                    subtitle: acquired ? acquiredLabel(acquired.on, acquired.precision) : 'What was paid',
                    value: formatMinor(value.costMinor, currency),
                    note: null,
                    tone: 'quiet' as const,
                  },
                },
              ]
            : []),
        ]
      : [];
  const onlyBuys = (trades.data ?? []).every((row) => row.kind === 'buy');
  const listTitle = estimated ? 'Value history' : byMoney ? 'History' : onlyBuys ? 'Purchases' : 'Buys and sells';
  const shown = all ? lines : lines.slice(0, FOLDED);

  return (
    <div className={SCREEN}>
      <PushedTitle title={value.name} back="Assets" backTo="/net-worth/assets" actions={menu} />
      <ErrorBox error={profile.error ?? error ?? stock.error} />
      {notice && (
        <Panel className="text-[13px] leading-[17px] text-[var(--ph-tint)]" testId="trade-notice">
          {notice}
        </Panel>
      )}

      {/*
       * The account page's card, as the Accounts tab draws its Balance: what it is worth now, one grey line with the
       * gain at its end, the line the figure is the end of, and its four figures under it.
       */}
      <BalanceCard
        label="Value now"
        minor={value.valueMinor}
        currency={currency}
        series={series}
        ends={estimated ? ['12 months ago', 'today'] : ['30 days ago', 'today']}
        throughZero={false}
        testId="asset-card"
        caption={
          <>
            <span className="block">
              {line}
              {gain && (
                <>
                  {' · '}
                  <span data-testid="asset-gain" data-tone={gain.tone} className={cx('tabular font-medium', gain.tone === 'gain' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]')}>
                    {gain.text}
                  </span>
                </>
              )}
            </span>
            {currency !== ws.baseCurrency && <span className="block">{approxLine(value.valueMinor, currency, ws.baseCurrency, held.data?.rates ?? {})}</span>}
          </>
        }
      >
        {tiles.length > 0 && (
          <NumberGrid
            tiles={tiles}
            refresh={priced && latestPrice && fetcher ? { label: fetcher.label, busy: fetcher.state === 'fetching', run: fetcher.run } : undefined}
          />
        )}
      </BalanceCard>

      <ActionButtons actions={actions} />

      {/* With a price, its source and day are behind the price figure's ⓘ; with none yet there is no figure to hang it on. */}
      {priced && !latestPrice && (
        <div className="-mt-[6px] mb-[18px] flex items-center justify-between gap-2 px-[6px] md:max-w-2xl">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="price-line">
            {saidPrice}
          </p>
          {/* Only a holding that follows a fetched price can fetch one; a typed-only holding has nothing to refresh. */}
          {fetcher && (
            <button
              type="button"
              aria-label={fetcher.label}
              disabled={fetcher.state === 'fetching'}
              onClick={fetcher.run}
              className="ph-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-tint)] disabled:opacity-40"
            >
              <RotateCw size={14} aria-hidden className={fetcher.state === 'fetching' ? 'animate-spin' : undefined} />
            </button>
          )}
        </div>
      )}


      {lines.length > 0 && (
        <InsetGroup
          header={listTitle}
          trailing={
            lines.length > FOLDED ? (
              <button type="button" onClick={() => setAll((was) => !was)} className="ph-focus rounded text-[13px] font-medium tracking-normal text-[var(--ph-tint)] normal-case">
                {all ? 'Fewer' : 'See all'}
              </button>
            ) : undefined
          }
        >
          {shown.map(({ key, line: l, row, valuation }) => (
            <HistoryRow
              key={key}
              line={l}
              onMore={row ? () => setSheet({ kind: 'row', trade: row, title: l.title }) : valuation ? () => setSheet({ kind: 'estimate', valuation }) : undefined}
            />
          ))}
        </InsetGroup>
      )}

      <Details
        rows={[
          priced && (kind === 'stock' || stock.security) ? (
            <InsetRow
              key="ticker"
              title="Ticker"
              value={stock.security ? stock.security.ticker || stock.security.name : 'Not set'}
              to="/net-worth/investments/new"
              search={{ link: accountId }}
            />
          ) : null,
          // A fund or a bond is held at an institution — a bank, a broker, a fund app — never inside one of its accounts:
          // the institution's name, typed with the names already used and (in rupiah) the places that sell funds and
          // bonds offered above the keyboard, is its Nama institusi.
          kind === 'fund' || kind === 'bond' ? (
            profile.data ? (
              <SuggestRow
                key={`held-${heldName}`}
                label="Institution"
                stripLabel="Institutions"
                value={placeDraft ?? heldName}
                onChange={setPlaceDraft}
                onCommit={(name) => {
                  setPlaceDraft(null);
                  void stock.placeName(profile.data!, name);
                }}
                placeholder="Not set"
                offers={(typed) => fundPlaceMatches(typed, institutions, ws.baseCurrency === 'IDR')}
              />
            ) : null
          ) : null,
          // The coupon's day and what lands after the tax withheld, from the bond's terms in its Settings.
          coupon ? (
            <InsetRow
              key="coupon"
              title="Next coupon"
              value={matured ? 'Matured' : nextCoupon ? `${dayLabel(coupon.nextOn)} · ${formatMinor(nextCoupon.grossMinor - nextCoupon.taxMinor, currency)}` : dayLabel(coupon.nextOn)}
              to="/net-worth/assets/$accountId/settings"
              params={{ accountId }}
            />
          ) : null,
          // The day the value was last set: the value itself is the hero's figure.
          byMoney && lastValued ? <ReadOnlyRow key="valued" label="Last updated" value={dayLabel(lastValued)} /> : null,
          kind !== 'fund' && kind !== 'bond' && (priced || byMoney) && ((kind !== null && BROKER_KINDS.includes(kind)) || stock.security) ? (
            // "No broker" is an answer the row prints, so it has a value of its own rather than a prompt's empty one. A listed
            // share is always kept at a broker: it is offered only to a share recorded before one was named.
            <SelectRow
              key="kept"
              label="Broker"
              value={stock.link?.brokerAccountId ?? 'none'}
              onChange={(e) => (e.target.value === NEW_BROKER ? setSheet({ kind: 'new-broker' }) : void stock.keptAt(e.target.value === 'none' ? '' : e.target.value))}
            >
              {!stock.link?.brokerAccountId ? <option value="none">No broker</option> : null}
              {stock.brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {/* One not in the app yet is opened here by name, as Add a holding opens one. */}
              <option value={NEW_BROKER}>Another broker…</option>
            </SelectRow>
          ) : null,
          // The broker's cash is held by a custodian bank: buying takes it from there, and selling puts it back.
          rdnBank ? <InsetRow key="cash" title="Custodian" value={rdnBank} chevron={false} /> : null,
          boughtWith ? (
            <InsetRow key="loan" title="Loan" value={`${boughtWith.lenderName} · See the loan`} to="/net-worth/loans/$accountId" params={{ accountId: boughtWith.accountId }} />
          ) : null,
        ]}
      />

      {/* Joint net worth (§8.1): what the household sees of it, under the facts. Nothing while this person is in no group. */}
      <ShareWithHouseholdRow accountId={accountId} />

      {forGoals.length > 0 && (
        <InsetGroup header="For goals" footer="Each buy's or sell's goal is changed from its ⋮ in the list above.">
          {forGoals.map((link) => (
            <InsetRow
              key={link.goalId}
              title={(goals.data ?? []).find((goal) => goal.id === link.goalId)?.name ?? 'A goal'}
              subtitle={link.unitsMicro !== null ? `${formatUnits(link.unitsMicro)} ${unitLabel}` : link.moneyMinor != null ? `${formatMinor(link.moneyMinor, currency)} put in` : undefined}
              value={<Money minor={link.valueMinor} currency={currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
        </InsetGroup>
      )}

      {sheet?.kind === 'price' && (
        <PriceSheet
          accountId={accountId}
          currency={currency}
          unitKind={unitKind}
          unitsMicro={unitsMicro}
          unitLabel={unitLabel}
          priceMicro={latestPrice?.priceMicro ?? null}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'new-broker' && <NewBrokerSheet onSave={(name) => void stock.newBroker(name).then(() => setSheet(null))} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'listed-source' && listedSecurity && listedChoice && (
        <PriceSourceSheet
          choice={listedChoice}
          options={listedSourceOptions(listedSecurity)}
          onPick={(next) => {
            setSheet(null);
            void (async () => {
              try {
                await setSecurityPriceChoice(database, ws, listedSecurity.id, next);
                await invalidate();
              } catch (e) {
                setError(e);
              }
            })();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'listed-trade' && idxShare && (
        <ListedTradeSheet
          kind={sheet.trade}
          holding={holding}
          security={idxShare}
          lastPrice={latestPrice}
          position={position}
          brokerAccountId={brokerId}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'fund-trade' && fundHolding && (
        <FundTradeSheet
          kind={sheet.trade}
          holding={holding}
          icon={<KindGlyph size={16} aria-hidden />}
          lastPrice={latestPrice}
          position={position}
          defaultCashId={brokerId}
          onClose={() => setSheet(null)}
          byMoney={byMoney ? { valueMinor: value.valueMinor } : null}
        />
      )}
      {sheet?.kind === 'switch' && byMoney && (
        <SwitchSheet
          fromAccountId={sheet.editing ? sheet.editing.out.accountId : accountId}
          icon={<KindGlyph size={16} aria-hidden />}
          editing={sheet.editing}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'gold-trade' && goldHolding && (
        <GoldTradeSheet
          kind={sheet.trade}
          holding={holding}
          icon={<KindGlyph size={16} aria-hidden />}
          lastPrice={latestPrice}
          position={position}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'gold-chart' && (
        <GoldChartSheet
          currency={currency}
          trades={trades.data ?? []}
          latest={latestPrice}
          costMinor={value.costMinor}
          unitsMicro={unitsMicro}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'value' && <ValueSheet accountId={accountId} currency={currency} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit-value' && <ValueSheet accountId={accountId} currency={currency} editing={sheet.valuation} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'estimate' && (
        <TradeActionsSheet
          title={`${BASIS_LABELS[sheet.valuation.basis] ?? sheet.valuation.basis} · ${dayLabel(sheet.valuation.asOf)}`}
          onEdit={() => setSheet({ kind: 'edit-value', valuation: sheet.valuation })}
          onDelete={() => void removeValuation(sheet.valuation)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'trade' && (
        <TradeSheet title={sheet.title} holding={holding} initial={sheet.initial} editing={sheet.editing} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'row' && (
        <TradeActionsSheet
          title={sheet.title}
          onEdit={() =>
            sheet.trade.switchedWith
              ? void editSwitch(sheet.trade)
              : setSheet({ kind: 'trade', title: 'Edit trade', initial: draftFromTrade(sheet.trade, currency), editing: sheet.trade })
          }
          onDelete={() => void removeTrade(sheet.trade)}
          // A buy's or a sell's goal, when there is a goal to give it; a switch moved money between funds, not toward one.
          goals={
            (sheet.trade.kind === 'buy' || sheet.trade.kind === 'sell') && !sheet.trade.switchedWith && (goals.data?.length ?? 0) > 0
              ? { value: goalSaid(sheet.trade), open: () => setSheet({ kind: 'goals', trade: sheet.trade }) }
              : undefined
          }
          reinvested={
            sheet.trade.kind === 'income'
              ? {
                  value: (sheet.trade.reinvestedMinor ?? 0) > 0 ? formatMinor(sheet.trade.reinvestedMinor!, currency) : 'None',
                  open: () => setSheet({ kind: 'reinvested', trade: sheet.trade }),
                }
              : undefined
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'goals' && (
        <TradeGoalsSheet
          trade={sheet.trade}
          holding={{ currency, byMoney, unitLabel }}
          onDone={(said) => {
            setSheet(null);
            setNotice(said);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'reinvested' && (
        <ReinvestedSheet
          trade={sheet.trade}
          currency={currency}
          onDone={(said) => {
            setSheet(null);
            setNotice(said);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/**
 * The labelled figures inside the card, two to a row: a small grey label, the figure under it. The one a word
 * qualifies carries it under the figure, and its ⓘ opens what it means (a world gold price: "Not buyback") under the grid.
 */
export function NumberGrid({ tiles, refresh }: { tiles: Tile[]; refresh?: { label: string; busy: boolean; run: () => void } }) {
  const [explained, setExplained] = useState<string | null>(null);
  const said = tiles.find((tile) => tile.label === explained)?.info;
  return (
    <div className="border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="asset-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0">
            <dt className="flex items-center gap-[5px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
              <span className="truncate">{tile.label}</span>
              {tile.info && (
                <button
                  type="button"
                  aria-label={`About ${tile.label}`}
                  aria-expanded={explained === tile.label}
                  onClick={() => setExplained((was) => (was === tile.label ? null : tile.label))}
                  className="ph-focus ph-tap flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full"
                >
                  <Info size={13} aria-hidden />
                </button>
              )}
            </dt>
            <dd className="tabular truncate text-[15px] leading-[20px] font-semibold text-[var(--ph-ink)]">{tile.value}</dd>
            {/* The word that qualifies the figure sits under it, where a half-width figure has the room. */}
            {tile.tag && <dd className="mt-[3px] inline-block rounded-full bg-[var(--ph-fill)] px-[7px] text-[11px] leading-[16px] text-[var(--ph-ink-3)]">{tile.tag}</dd>}
          </div>
        ))}
      </dl>
      {said && (
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="price-said">
            {said}
          </p>
          {/* A holding that follows the world price can fetch today's again, from where its price is explained. */}
          {refresh && (
            <button
              type="button"
              aria-label={refresh.label}
              disabled={refresh.busy}
              onClick={refresh.run}
              className="ph-focus flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-tint)] disabled:opacity-40"
            >
              <RotateCw size={13} aria-hidden className={refresh.busy ? 'animate-spin' : undefined} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** One line of the history: what happened and when on the left, the figure with its own gain on the right, and ⋮. */
function HistoryRow({ line, onMore, position }: GroupChild & { line: TradeLine; onMore?: () => void }) {
  return (
    <div className="relative" data-testid="asset-history-row">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ padding: `${ROW_PAD_Y}px ${onMore ? 4 : ROW_PAD_X}px ${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{line.title}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{line.subtitle}</span>
        </span>
        <span className="tabular shrink-0 text-right">
          <span className="block text-[15px] leading-[20px] text-[var(--ph-ink)]">{line.value}</span>
          {line.note && (
            <span
              className={cx(
                'block text-[12.5px] leading-[16px]',
                line.tone === 'gain' ? 'text-[var(--ph-up)]' : line.tone === 'loss' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]',
              )}
            >
              {line.note}
            </span>
          )}
        </span>
        {onMore && (
          <button
            type="button"
            aria-label={`More for ${line.title}, ${line.subtitle}`}
            onClick={onMore}
            className="ph-focus flex h-11 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          >
            <MoreVertical size={18} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** The plain facts, one to a row. Nothing is drawn when there are none. */
function Details({ rows }: { rows: (ReactElement | null)[] }) {
  const present = rows.filter((row): row is ReactElement => row !== null);
  if (present.length === 0) return null;
  return <InsetGroup header="Details">{present}</InsetGroup>;
}
