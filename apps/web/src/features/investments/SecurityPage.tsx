import { formatBps, formatMinor, formatPriceMicro, formatUnits, gainBps, isoDate, priceMicroFrom } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { Navigate, useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import { approxLine, Figure, InsetGroup, InsetRow, PushedTitle, rateLine, ReadOnlyRow, SCREEN } from '../../ui/native';
import { BalanceCard } from '../accounts/BalanceCard';
import { LINE_DAYS } from '../accounts/queries';
import { NumberGrid } from '../networth/AssetDetailPage';
import { gainPill, priceLine, pricedDaySeries } from '../networth/asset-page';
import { useAssetProfiles, usePrices, useTrades } from '../networth/queries';
import { InvestTable } from './InvestTable';
import { type HoldingLine, heldAtPlaces, keptAt, type StockRow } from './portfolio-view';
import { usePortfolio } from './queries';
import {
  baseGainLine,
  boughtAtRate,
  combinedSeries,
  dividendsInYear,
  fundTiles,
  institutionLine,
  overallTiles,
  placeTitle,
  type RecentLine,
  securityPageModel,
  soleHolding,
} from './security-view';

type Rates = Readonly<Record<string, number>>;

const BACK = { back: 'Assets', backTo: '/net-worth/assets' } as const;

/** "Stockbit", or — for a holding kept with no broker, of which there may be several — its own name beside it. */
const holdingTitle = (h: HoldingLine) => (h.brokerAccountId ? h.brokerName : `${h.brokerName} · ${h.name}`);

function recentDetail(line: RecentLine, base: string): string {
  const at = line.pinnedRate !== null ? `at ${rateLine(line.pinnedRate, line.currency, base)}` : null;
  return [line.brokerName, line.day, at, line.pinnedBaseMinor !== null ? formatMinor(line.pinnedBaseMinor, base) : null].filter(Boolean).join(' · ');
}

/** A foreign stock in base — both true: the card holds the stock's own figure, this one includes the rate. */
function InBaseGroup({ stock, base, fund }: { stock: StockRow; base: string; fund: boolean }) {
  // With no rate today the row names the missing rate: never a value of 0 read as a −100% gain.
  const gainLine = baseGainLine(stock, base);
  const boughtAt = boughtAtRate(stock, base);
  if (stock.currency === base || (gainLine === null && boughtAt === null)) return null;
  return (
    <InsetGroup header={`In ${base}`} footer={`Both are true: the figure above is what the ${fund ? 'fund' : 'stock'} did; this one includes the exchange rate moving.`}>
      {gainLine !== null && <ReadOnlyRow label={`Gain in ${base}`} value={gainLine} />}
      {boughtAt !== null && <ReadOnlyRow label="Bought at" value={rateLine(boughtAt, stock.currency, base)} />}
    </InsetGroup>
  );
}

const TONE = { gain: 'text-[var(--ph-up)]', loss: 'text-[var(--ph-alarm)]', flat: 'text-[var(--ph-ink-3)]' } as const;

/** A holding's figure on its row: its value, and its own gain under it in green or red. */
function HoldingFigure({ h }: { h: HoldingLine }) {
  const { gain } = institutionLine(h, null);
  return (
    <span className="block text-right">
      <Figure tone={h.stale ? 'warn' : 'ink'}>{formatMinor(h.valueMinor, h.currency)}</Figure>
      {gain && (
        <span className={cx('tabular block text-[12.5px] leading-[16px]', TONE[gain.tone])} data-testid="held-at-gain" data-tone={gain.tone}>
          {gain.text}
        </span>
      )}
    </span>
  );
}

const HELD_FOOTER = 'Each broker keeps its own average price and its own cost basis.';
const FUND_FOOTER = 'Each place keeps its own money, value and trades.';

/**
 * `/net-worth/investments/security/$securityId` — one stock across the brokers it is held at, drawn as a holding's own
 * page is: the pushed title, the card with what it is worth now and its figures, then a row per broker opening that
 * holding, and the latest trades. No round buttons: a buy or a sell is at one broker, on that holding's page.
 *
 * A mutual fund tied across places by "Same fund as" opens here too, in the same design: a row per place, each its
 * institution by name, and its figures in a fund's words — never units added up from a place tracked by money.
 *
 * A stock held at one place only has nothing to add to that holding's page, so this address opens it instead.
 */
export function SecurityPage() {
  const { ws } = useApp();
  const { securityId = '' } = useParams({ strict: false }) as { securityId?: string };
  const { view, rates, costs, securities, error, isPending } = usePortfolio();
  const trades = useTrades();
  const profiles = useAssetProfiles();
  const base = ws.baseCurrency;
  const security = securities.find((s) => s.id === securityId);
  // A fund: every holding of the security is a mutual fund, as "Same fund as" ties only funds.
  const fundIds = new Set((profiles.data ?? []).filter((row) => row.assetKind === 'fund').map((row) => row.accountId));
  const held = view?.stocks.find((s) => s.securityId === securityId)?.holdings ?? [];
  const fund = held.length > 0 && held.every((h) => fundIds.has(h.accountId));
  const model = view && profiles.data ? securityPageModel({ view, securityId, trades: trades.data ?? [], buyBaseMinor: costs?.buyBaseMinor ?? {}, base, fund }) : null;
  const title = security ? (security.ticker ?? security.name) : 'Stock';
  if (!model || !security)
    return (
      <div className={SCREEN}>
        <PushedTitle title={title} {...BACK} />
        <ErrorBox error={error ?? profiles.error} />
        {!isPending && !error && profiles.data && <Empty>Nothing of this is held now.</Empty>}
      </div>
    );
  const sole = soleHolding(model.stock);
  // Replaced, so Back from the holding goes where it came from rather than here and straight back again.
  if (sole !== null) return <Navigate to="/net-worth/assets/$accountId" params={{ accountId: sole }} replace />;
  return <AcrossBrokers title={title} fund={fund} stock={model.stock} recent={model.recent} trades={trades.data ?? null} base={base} rates={rates} error={error ?? trades.error} />;
}

function AcrossBrokers({
  title,
  fund,
  stock,
  recent,
  trades,
  base,
  rates,
  error,
}: {
  title: string;
  fund: boolean;
  stock: StockRow;
  recent: RecentLine[];
  trades: readonly TradeRow[] | null;
  base: string;
  rates: Rates;
  error: unknown;
}) {
  const phone = usePhone();
  const today = isoDate();
  // One security, one price: any of its holdings reads the security's own prices, with where each came from.
  const prices = usePrices(stock.holdings[0]!.accountId);
  const latest = prices.data?.[0] ?? null;
  const foreign = stock.currency !== base;
  const ids = stock.holdings.map((h) => h.accountId);

  // Each holding's own line, as its page draws it, added up day by day. A holding tracked by money has no units to
  // price, so a stock with one draws no line rather than part of one.
  const series = useMemo(() => {
    if (!trades || !prices.data || stock.holdings.some((h) => h.unitsMicro <= 0)) return null;
    return combinedSeries(
      stock.holdings.map((h) =>
        pricedDaySeries(
          trades.filter((t) => t.accountId === h.accountId),
          prices.data,
          { accountId: h.accountId, currency: stock.currency, today, days: LINE_DAYS },
        ),
      ),
    );
  }, [trades, prices.data, stock, today]);

  const price = latest ? { priceMicro: latest.priceMicro, label: fund ? 'Price today' : 'Price', info: priceLine({ latest, fetches: false, failed: false, today }) } : null;
  const tiles = fund
    ? fundTiles({ stock, price })
    : overallTiles({ stock, price, dividendsMinor: trades ? dividendsInYear(trades, ids, today.slice(0, 4)) : null });
  const gain = gainPill(stock.valueMinor, stock.costMinor, stock.currency);
  const recentFooter = foreign ? `The ${base} cost of a buy is fixed at the rate on its day, and it never moves again.` : undefined;
  // A fund is held at an institution by name: each row is that place, never the account it was once linked to.
  const rowTitle = fund ? placeTitle : holdingTitle;
  const heldFooter = fund ? FUND_FOOTER : HELD_FOOTER;
  const byUnits = !fund || stock.holdings.every((h) => h.unitsMicro > 0);

  return (
    <div className={SCREEN}>
      <PushedTitle title={title} {...BACK} />
      <ErrorBox error={error ?? prices.error} />

      {/* The holding page's card: what it is worth now across every broker, the gain, its line, and four figures. */}
      <BalanceCard
        label={fund ? 'Value now · all places' : 'Value now · all brokers'}
        minor={stock.valueMinor}
        currency={stock.currency}
        series={series}
        ends={['30 days ago', 'today']}
        throughZero={false}
        testId="security-card"
        caption={
          <>
            <span className="block">
              {fund ? heldAtPlaces(stock) : keptAt(stock)}
              {gain && (
                <>
                  {' · '}
                  <span data-testid="security-gain" data-tone={gain.tone} className={cx('tabular font-medium', gain.tone === 'gain' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]')}>
                    {gain.text}
                  </span>
                </>
              )}
            </span>
            {foreign && <span className="block">{approxLine(stock.valueMinor, stock.currency, base, rates)}</span>}
          </>
        }
      >
        {tiles.length > 0 && <NumberGrid tiles={tiles} />}
      </BalanceCard>

      <InBaseGroup stock={stock} base={base} fund={fund} />

      {phone ? (
        <>
          <InsetGroup header="Institutions" footer={heldFooter}>
            {stock.holdings.map((h) => (
              <InsetRow
                key={h.accountId}
                testId="held-at-row"
                title={rowTitle(h)}
                subtitle={institutionLine(h, stock.lotSize, fund).subtitle || undefined}
                value={<HoldingFigure h={h} />}
                valueTone={h.stale ? 'warn' : 'ink'}
                to="/net-worth/assets/$accountId"
                params={{ accountId: h.accountId }}
              />
            ))}
          </InsetGroup>
          {recent.length > 0 && (
            <InsetGroup header="Recent" footer={recentFooter}>
              {recent.map((line) => (
                // Read-only on purpose: a trade is changed only on its holding's page, which works later sells out again (spec §9).
                <InsetRow key={line.id} testId="recent-row" title={line.title} subtitle={recentDetail(line, base)} value={<Money minor={line.grossMinor} currency={line.currency} />} valueTone="ink" />
              ))}
            </InsetGroup>
          )}
        </>
      ) : (
        // The desktop keeps every figure in a column of its own.
        <div>
          <InvestTable<HoldingLine>
            header="Institutions"
            footer={heldFooter}
            testId="held-at-table"
            rowTestId="held-at-row"
            records={stock.holdings}
            rowKey={(h) => h.accountId}
            title={rowTitle}
            destination={(h) => ({ to: '/net-worth/assets/$accountId', params: { accountId: h.accountId } })}
            columns={[
              { key: 'broker', heading: fund ? 'Institution' : 'Broker', cell: () => null },
              // A fund with a place tracked by money has no units to set beside the others: what is in each says it.
              ...(byUnits
                ? [
                    { key: 'shares', heading: fund ? 'Units' : 'Shares', numeric: true, cell: (h: HoldingLine) => formatUnits(h.unitsMicro) },
                    { key: 'avg', heading: 'Avg price', numeric: true, cell: (h: HoldingLine) => formatPriceMicro(priceMicroFrom(h.costMinor, h.unitsMicro), h.currency) },
                  ]
                : [{ key: 'in', heading: 'Money in', numeric: true, cell: (h: HoldingLine) => formatMinor(h.costMinor, h.currency) }]),
              {
                key: 'gain',
                heading: 'Gain',
                numeric: true,
                cell: (h) => {
                  const bps = gainBps(h.valueMinor, h.costMinor);
                  return bps === null ? '—' : <span className={TONE[bps > 0 ? 'gain' : bps < 0 ? 'loss' : 'flat']}>{formatBps(bps)}</span>;
                },
              },
              { key: 'value', heading: 'Value', numeric: true, cell: (h) => <Figure tone={h.stale ? 'warn' : 'ink'}>{formatMinor(h.valueMinor, h.currency)}</Figure> },
            ]}
          />
          {recent.length > 0 && (
            <InvestTable<RecentLine>
              header="Recent"
              footer={recentFooter}
              testId="recent-table"
              rowTestId="recent-row"
              records={recent}
              rowKey={(line) => line.id}
              title={(line) => line.title}
              // Read-only on purpose: a trade is changed only on its holding's page (spec §9).
              destination={() => null}
              columns={[
                { key: 'trade', heading: 'Trade', cell: () => null },
                { key: 'where', heading: fund ? 'Institution' : 'Broker', cell: (line) => line.brokerName },
                { key: 'day', heading: 'Day', cell: (line) => line.day },
                { key: 'amount', heading: 'Amount', numeric: true, cell: (line) => formatMinor(line.grossMinor, line.currency) },
                ...(foreign
                  ? [
                      {
                        key: 'base',
                        heading: `Cost in ${base}`,
                        numeric: true,
                        cell: (line: RecentLine) =>
                          line.pinnedBaseMinor === null ? (
                            '—'
                          ) : (
                            <>
                              {formatMinor(line.pinnedBaseMinor, base)}
                              {line.pinnedRate !== null && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">at {rateLine(line.pinnedRate, line.currency, base)}</span>}
                            </>
                          ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
