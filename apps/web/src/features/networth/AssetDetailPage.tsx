import { type AssetKind, assetItemOfCode, CASH_ITEMS, formatMinor, formatUnits, isoDate, lastNMonths, monthOf, presetFor, type UnitKind } from '@expanses/core';
import { archiveAccount, type AssetValueRow, deleteTrade, renameAccount, setGoldPriceChoice, type TradeRow } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Archive, ArrowDownLeft, Info, Minus, MoreHorizontal, MoreVertical, Pencil, Plus, RotateCw, Settings, SquarePen } from 'lucide-react';
import { type ReactElement, useState } from 'react';
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
  PushedTitle,
  ROW_PAD_X,
  ROW_PAD_Y,
  type RoundAction,
  SCREEN,
  SelectRow,
} from '../../ui/native';
import { AccountPage } from '../accounts/AccountPage';
import { BalanceCard } from '../accounts/BalanceCard';
import type { DayBalance } from '../accounts/balance-series';
import { LINE_DAYS, useHeldRates, useOpenings } from '../accounts/queries';
import { useGoalLinks, useGoals } from '../goals/queries';
import { useLoans } from '../loans/queries';
import { dayLabel, estimatedTiles, gainPill, heroLine, monthEnd, priceLine, pricedDaySeries, pricedTiles, type Tile, type TradeLine, tradeLine } from './asset-page';
import { PriceSheet, PriceSourceSheet, TradeActionsSheet, TradeSheet, ValueSheet } from './AssetSheets';
import { BASIS_LABELS, UNIT_LABELS } from './labels';
import { useAssetProfile, useAssetProfiles, useAssetValues, useMonthEndValues, usePositions, usePrices, useTrades, useValuations } from './queries';
import { useStockAndBroker } from './StockAndBroker';
import { draftFromTrade, type TradeDraft } from './trade-form';
import { useGoldPriceChoice, useWorldGoldPrice } from './world-gold';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';

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

type Sheet =
  | { kind: 'price' }
  | { kind: 'value' }
  | { kind: 'source' }
  | { kind: 'trade'; title: string; initial: Partial<TradeDraft>; editing: TradeRow | null }
  | { kind: 'row'; trade: TradeRow; title: string };

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
  const prices = usePrices(accountId);
  const valuations = useValuations(accountId);
  const trades = useTrades(accountId);
  const history = useMonthEndValues(accountId, months);
  const goalLinks = useGoalLinks();
  const goals = useGoals();
  const loans = useLoans();
  const balances = useBalances();
  const openings = useOpenings([accountId]);
  const held = useHeldRates(currency === ws.baseCurrency ? [] : [currency]);
  const stock = useStockAndBroker(accountId);
  const profiles = useAssetProfiles();
  const brokerId = stock.link?.brokerAccountId ?? null;
  const rdnBank = brokerId ? (profiles.data ?? []).find((row) => row.accountId === brokerId)?.coretaxFields.inst?.trim() || null : null;
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [all, setAll] = useState(false);

  const kind = profile.data?.assetKind ?? null;
  const unitKind = profile.data?.unitKind ?? null;
  const priced = value.mode === 'market';
  const estimated = value.mode === 'snapshot';
  const position = positions.data?.[accountId];
  const unitsMicro = position?.unitsMicro ?? 0;
  // A linked holding counts in the security's lots; one of its own, in the lot its settings say.
  const lotSize = stock.security?.lotSize ?? profile.data?.lotSize ?? null;
  const latestPrice = prices.data?.[0] ?? null;
  // Gold counted in grams follows the world price unless its owner chose to type every price.
  const gold = priced && kind === 'gold' && unitKind === 'grams';
  const choiceQuery = useGoldPriceChoice(accountId, gold);
  const choice = gold ? (choiceQuery.data ?? null) : null;
  const world = useWorldGoldPrice({ accountId, currency, choice, latest: latestPrice, ready: prices.isSuccess && choiceQuery.isSuccess });
  const latestValuation = (valuations.data ?? []).find((row) => row.basis !== 'njop' && row.asOf === value.asOf) ?? null;
  const kindLabel = assetItemOfCode(value.coretaxCode)?.label ?? (kind ? presetFor(kind).label : 'Asset');
  const boughtWith = (loans.data ?? []).find((loan) => loan.assetAccountId === accountId && loan.status === 'open');
  const owedMinor = boughtWith ? Math.abs(balances.data?.[boughtWith.accountId] ?? 0) : 0;
  const forGoals = (goalLinks.data ?? []).filter((link) => link.accountId === accountId && link.kind === 'tagged');
  const canArchive = value.valueMinor === 0 && unitsMicro === 0;
  const holding = { accountId, name: value.name, currency };
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

  const tiles: Tile[] = priced
    ? pricedTiles({
        unitKind,
        unitsMicro,
        costMinor: value.costMinor,
        lotSize,
        currency,
        priceMicro: latestPrice?.priceMicro ?? null,
        ...(gold && latestPrice?.source === 'world'
          ? { priceLabel: 'World price', priceTag: { tag: 'not buyback', info: 'The world spot price. A dealer usually buys gold back a few percent below it.' } }
          : { priceLabel: gold ? 'Your price' : unitKind ? PRICE_TILE[unitKind] : 'Price today' }),
      })
    : estimated
      ? estimatedTiles({
          costMinor: value.costMinor,
          boughtOn: openings.data?.[accountId]?.occurredOn ?? null,
          currency,
          loan: boughtWith ? { valueMinor: value.valueMinor, owedMinor } : null,
        })
      : [];

  const trade = (title: string, initial: Partial<TradeDraft>) => () => setSheet({ kind: 'trade', title, initial, editing: null });
  const actions: RoundAction[] = priced
    ? [
        { key: 'buy', label: 'Buy', glyph: <Plus size={20} aria-hidden />, run: trade('Buy', { kind: 'buy' }) },
        { key: 'sell', label: 'Sell', glyph: <Minus size={20} aria-hidden />, run: trade('Sell', { kind: 'sell' }) },
        // Gold pays nothing while it is held; a share, a fund and a bond each pay in their own word.
        ...(kind === 'gold'
          ? []
          : [{ key: 'income', label: incomeWordOf(kind), glyph: <ArrowDownLeft size={20} aria-hidden />, run: trade(incomeWordOf(kind), { kind: 'income' }) }]),
        { key: 'price', label: 'Price', glyph: <SquarePen size={20} aria-hidden />, run: () => setSheet({ kind: 'price' }) },
      ]
    : estimated
      ? [{ key: 'value', label: 'Update value', glyph: <SquarePen size={20} aria-hidden />, run: () => setSheet({ kind: 'value' }) }]
      : [];

  async function removeTrade(row: TradeRow) {
    setSheet(null);
    if (!window.confirm('Delete this trade? Later sells are worked out again at the new average cost.')) return;
    setError(null);
    try {
      await deleteTrade(database, ws, row.id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const menu: CornerAction[] = [
    {
      key: 'more',
      label: 'More',
      glyph: <MoreHorizontal size={20} aria-hidden />,
      menu: [
        { key: 'settings', label: 'Settings', glyph: <Settings size={18} aria-hidden />, to: '/net-worth/assets/$accountId/settings', params: { accountId } },
        {
          key: 'edit',
          label: 'Edit',
          glyph: <Pencil size={18} aria-hidden />,
          run: () => {
            const next = window.prompt('Rename', value.name);
            if (!next || next.trim() === '' || next === value.name) return;
            void (async () => {
              try {
                await renameAccount(database, ws, accountId, next);
                await invalidate();
              } catch (e) {
                setError(e);
              }
            })();
          },
        },
        {
          key: 'archive',
          label: 'Archive',
          glyph: <Archive size={18} aria-hidden />,
          disabled: !canArchive,
          detail: canArchive ? undefined : 'Archiving is available once nothing is left in this asset.',
          run: () => {
            if (!window.confirm(`Archive ${value.name}? It leaves the list; its history stays.`)) return;
            void (async () => {
              try {
                await archiveAccount(database, ws, accountId);
                await invalidate();
                await navigate({ to: '/net-worth/assets' });
              } catch (e) {
                setError(e);
              }
            })();
          },
        },
      ],
    },
  ];

  const lines: { key: string; line: TradeLine; row: TradeRow | null }[] = priced
    ? [...(trades.data ?? [])].reverse().map((row) => ({
        key: row.id,
        row,
        line: tradeLine(row, { unitKind, lotSize, currency, priceMicro: latestPrice?.priceMicro ?? null, incomeWord: incomeWordOf(kind) }),
      }))
    : estimated
      ? [
          ...(valuations.data ?? []).map((row) => ({
            key: row.id,
            row: null,
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
                    title: 'Bought',
                    subtitle: openings.data?.[accountId] ? dayLabel(openings.data[accountId]!.occurredOn) : 'What was paid',
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
  const listTitle = estimated ? 'Value history' : onlyBuys ? 'Purchases' : 'Buys and sells';
  const shown = all ? lines : lines.slice(0, FOLDED);

  return (
    <div className={SCREEN}>
      <PushedTitle title={value.name} back="Assets" backTo="/net-worth/assets" actions={menu} />
      <ErrorBox error={profile.error ?? error ?? stock.error} />

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
                  <span data-testid="asset-gain" data-tone={gain.tone} className={cx('tabular font-medium', gain.tone === 'gain' ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-alarm)]')}>
                    {gain.text}
                  </span>
                </>
              )}
            </span>
            {currency !== ws.baseCurrency && <span className="block">{approxLine(value.valueMinor, currency, ws.baseCurrency, held.data?.rates ?? {})}</span>}
          </>
        }
      >
        {tiles.length > 0 && <NumberGrid tiles={tiles} />}
      </BalanceCard>

      <ActionButtons actions={actions} />

      {priced && (
        <div className="-mt-[6px] mb-[18px] flex items-center justify-between gap-2 px-[6px] md:max-w-2xl">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="price-line">
            {priceLine({ latest: latestPrice, followsWorld: choice === 'world', failed: world.state === 'failed', today: isoDate() })}
          </p>
          {/* Only a holding that follows the world price can fetch one; a typed-only holding has nothing to refresh. */}
          {choice === 'world' && (
            <button
              type="button"
              aria-label="Fetch today’s world price"
              disabled={world.state === 'fetching'}
              onClick={world.retry}
              className="ph-focus flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-tint)] disabled:opacity-40"
            >
              <RotateCw size={14} aria-hidden className={world.state === 'fetching' ? 'animate-spin' : undefined} />
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
          {shown.map(({ key, line: l, row }) => (
            <HistoryRow
              key={key}
              line={l}
              onMore={row ? () => setSheet({ kind: 'row', trade: row, title: l.title }) : undefined}
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
          priced && ((kind !== null && BROKER_KINDS.includes(kind)) || stock.security) ? (
            // "No broker" is an answer the row prints, so it has a value of its own rather than a prompt's empty one.
            <SelectRow key="kept" label="Kept at" value={stock.link?.brokerAccountId ?? 'none'} onChange={(e) => void stock.keptAt(e.target.value === 'none' ? '' : e.target.value)}>
              <option value="none">No broker</option>
              {stock.brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectRow>
          ) : null,
          choice ? (
            <InsetRow key="source" title="Price source" value={choice === 'world' ? 'World price' : "I'll type it"} onClick={() => setSheet({ kind: 'source' })} />
          ) : null,
          // The broker's cash sits at a bank: buying takes it from there, and selling puts it back.
          rdnBank ? <InsetRow key="cash" title="Cash through" value={`RDN at ${rdnBank}`} chevron={false} /> : null,
          boughtWith ? (
            <InsetRow key="loan" title="Loan" value={`${boughtWith.lenderName} · See the loan`} to="/net-worth/loans/$accountId" params={{ accountId: boughtWith.accountId }} />
          ) : null,
        ]}
      />

      {/* Joint net worth (§8.1): what the household sees of it, under the facts. Nothing while this person is in no group. */}
      <ShareWithHouseholdRow accountId={accountId} />

      {forGoals.length > 0 && (
        <InsetGroup header="For goals">
          {forGoals.map((link) => (
            <InsetRow
              key={link.goalId}
              title={(goals.data ?? []).find((goal) => goal.id === link.goalId)?.name ?? 'A goal'}
              subtitle={link.unitsMicro === null ? undefined : `${formatUnits(link.unitsMicro)} ${unitLabel}`}
              value={<Money minor={link.valueMinor} currency={currency} />}
              valueTone="ink"
              chevron={false}
            />
          ))}
          <InsetRow title="Change on Buy & sell" to="/net-worth/trades" />
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
      {sheet?.kind === 'source' && choice && (
        <PriceSourceSheet
          choice={choice}
          onPick={(next) => {
            setSheet(null);
            void (async () => {
              try {
                await setGoldPriceChoice(database, ws, accountId, next);
                await invalidate();
              } catch (e) {
                setError(e);
              }
            })();
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'value' && <ValueSheet accountId={accountId} currency={currency} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'trade' && (
        <TradeSheet title={sheet.title} holding={holding} initial={sheet.initial} editing={sheet.editing} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'row' && (
        <TradeActionsSheet
          title={sheet.title}
          onEdit={() => setSheet({ kind: 'trade', title: 'Edit trade', initial: draftFromTrade(sheet.trade, currency), editing: sheet.trade })}
          onDelete={() => void removeTrade(sheet.trade)}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

/**
 * The labelled figures inside the card, two to a row: a small grey label, the figure under it. The one a word
 * qualifies ("not buyback") carries it under the figure, and its ⓘ opens what it means under the grid.
 */
function NumberGrid({ tiles }: { tiles: Tile[] }) {
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
      {said && <p className="mt-2 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{said}</p>}
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
                line.tone === 'gain' ? 'text-[var(--ph-tint)]' : line.tone === 'loss' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]',
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
