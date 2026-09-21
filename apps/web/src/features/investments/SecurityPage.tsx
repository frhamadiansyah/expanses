import { formatBps, formatLots, formatMinor, formatPriceMicro, formatUnits, gainBps, priceMicroFrom } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import { approxLine, Figure, Hero, InsetGroup, InsetRow, LargeTitle, rateLine, ReadOnlyRow, SCREEN } from '../../ui/native';
import { useTrades } from '../networth/queries';
import { DesktopBand, InvestTable } from './InvestTable';
import { dayLabel, type HoldingLine, type StockRow } from './portfolio-view';
import { usePortfolio, useSecurityPrices } from './queries';
import { baseGainLine, boughtAtRate, type RecentLine, securityPageModel } from './security-view';

type Rates = Readonly<Record<string, number>>;

const BACK = { back: 'Investments', backTo: '/net-worth/investments' } as const;

/** "Stockbit", or — for a holding kept with no broker, of which there may be several — its own name beside it. */
const holdingTitle = (h: HoldingLine) => (h.brokerAccountId ? h.brokerName : `${h.brokerName} · ${h.name}`);

function holdingDetail(h: HoldingLine): string {
  const bps = gainBps(h.valueMinor, h.costMinor);
  return [`${formatUnits(h.unitsMicro)} shares`, `avg ${formatPriceMicro(priceMicroFrom(h.costMinor, h.unitsMicro), h.currency)}`, bps === null ? null : formatBps(bps)]
    .filter(Boolean)
    .join(' · ');
}

function recentDetail(line: RecentLine, base: string): string {
  const at = line.pinnedRate !== null ? `at ${rateLine(line.pinnedRate, line.currency, base)}` : null;
  return [line.brokerName, line.day, at, line.pinnedBaseMinor !== null ? formatMinor(line.pinnedBaseMinor, base) : null].filter(Boolean).join(' · ');
}

/** The figure the page is for: the stock in its own currency, its gain, and for a foreign one the ≈ line and the rate. */
function StockFigure({ stock, base, rates, left }: { stock: StockRow; base: string; rates: Rates; left: boolean }) {
  const foreign = stock.currency !== base;
  const rate = rates[stock.currency];
  return (
    <>
      <div data-testid="security-total">
        <Hero
          minor={stock.valueMinor}
          currency={stock.currency}
          align={left ? 'start' : 'center'}
          caption={
            <>
              {formatMinor(stock.valueMinor - stock.costMinor, stock.currency)}
              {stock.gainBps === null ? '' : ` · ${formatBps(stock.gainBps)}`}
              {foreign && (
                // The kit's own ≈ line (or "No USD rate yet"), then the rate it used in the kit's own words.
                <span className="block">
                  {approxLine(stock.valueMinor, stock.currency, base, rates)}
                  {rate !== undefined ? ` · at ${rateLine(rate, stock.currency, base)}` : ''}
                </span>
              )}
            </>
          }
        />
      </div>
    </>
  );
}

/** A foreign stock in base — both true: R1 puts the stock's own figure in the big text, this one includes the rate. */
function InBaseGroup({ stock, base }: { stock: StockRow; base: string }) {
  // With no rate today the row names the missing rate: never a value of 0 read as a −100% gain.
  const gainLine = baseGainLine(stock, base);
  const boughtAt = boughtAtRate(stock, base);
  return (
    <>
      {stock.currency !== base && (gainLine !== null || boughtAt !== null) && (
        <InsetGroup header={`In ${base}`} footer="Both are true: the figure above is what the stock did; this one includes the exchange rate moving.">
          {gainLine !== null && <ReadOnlyRow label={`Gain in ${base}`} value={gainLine} />}
          {boughtAt !== null && <ReadOnlyRow label="Bought at" value={rateLine(boughtAt, stock.currency, base)} />}
        </InsetGroup>
      )}
    </>
  );
}

function PriceRows({ stock, securityId, latest }: { stock: StockRow; securityId: string; latest: { onDate: string; priceMicro: number } | undefined }) {
  return (
    <InsetGroup>
      {stock.unitsMicro > 0 && <ReadOnlyRow label="Avg price" value={formatPriceMicro(priceMicroFrom(stock.costMinor, stock.unitsMicro), stock.currency)} />}
      <InsetRow
        title="Price today"
        subtitle={latest ? `Set by you · ${dayLabel(latest.onDate)}` : 'Not set yet'}
        value={latest ? formatPriceMicro(latest.priceMicro, stock.currency) : undefined}
        valueTone={stock.stale ? 'warn' : 'ink'}
        to="/net-worth/investments/security/$securityId/price"
        params={{ securityId }}
      />
    </InsetGroup>
  );
}

const HELD_FOOTER = 'Each broker keeps its own average price and its own cost basis.';

export function SecurityPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const { securityId = '' } = useParams({ strict: false }) as { securityId?: string };
  const { view, rates, costs, securities, error, isPending } = usePortfolio();
  const prices = useSecurityPrices(securityId);
  const trades = useTrades();
  const base = ws.baseCurrency;
  const security = securities.find((s) => s.id === securityId);
  const model = view ? securityPageModel({ view, securityId, trades: trades.data ?? [], buyBaseMinor: costs?.buyBaseMinor ?? {}, base }) : null;
  const title = security ? (security.ticker ?? security.name) : 'Stock';
  if (!model || !security)
    return (
      <div className={SCREEN}>
        <LargeTitle title={title} {...BACK} oneLine />
        <ErrorBox error={error} />
        {!isPending && !error && <Empty>Nothing of this is held now.</Empty>}
      </div>
    );

  const { stock, recent } = model;
  const latest = prices.data?.[0];
  const foreign = stock.currency !== base;
  const recentFooter = foreign ? `The ${base} cost of a buy is fixed at the rate on its day, and it never moves again.` : undefined;
  const subtitle = [security.name !== title ? security.name : null, formatLots(stock.unitsMicro, stock.lotSize ?? 1), security.market || null].filter(Boolean).join(' · ');

  return (
    <div className={SCREEN}>
      <LargeTitle title={title} {...BACK} subtitle={subtitle} oneLine />
      <ErrorBox error={error ?? prices.error ?? trades.error} />
      {phone ? (
        <>
          <StockFigure stock={stock} base={base} rates={rates} left={false} />
          <InBaseGroup stock={stock} base={base} />
          <PriceRows stock={stock} securityId={securityId} latest={latest} />
          <InsetGroup header="Held at" footer={HELD_FOOTER}>
            {stock.holdings.map((h) => (
              <InsetRow
                key={h.accountId}
                testId="held-at-row"
                title={holdingTitle(h)}
                subtitle={holdingDetail(h)}
                value={<Money minor={h.valueMinor} currency={h.currency} />}
                valueTone={h.stale ? 'warn' : 'ink'}
                to="/net-worth/assets/$accountId"
                params={{ accountId: h.accountId }}
              />
            ))}
          </InsetGroup>
          {recent.length > 0 && (
            <InsetGroup header="Recent" footer={recentFooter}>
              {recent.map((line) => (
                // Read-only on purpose: a trade is changed only on Buy & sell, which works later sells out again (spec §9).
                <InsetRow key={line.id} testId="recent-row" title={line.title} subtitle={recentDetail(line, base)} value={<Money minor={line.grossMinor} currency={line.currency} />} valueTone="ink" />
              ))}
            </InsetGroup>
          )}
        </>
      ) : (
        <>
          <DesktopBand
            figure={
              <>
                <StockFigure stock={stock} base={base} rates={rates} left />
                <InBaseGroup stock={stock} base={base} />
              </>
            }
            facts={<PriceRows stock={stock} securityId={securityId} latest={latest} />}
          />
          <div>
            <InvestTable<HoldingLine>
              header="Held at"
              footer={HELD_FOOTER}
              testId="held-at-table"
              rowTestId="held-at-row"
              records={stock.holdings}
              rowKey={(h) => h.accountId}
              title={holdingTitle}
              destination={(h) => ({ to: '/net-worth/assets/$accountId', params: { accountId: h.accountId } })}
              columns={[
                { key: 'broker', heading: 'Broker', cell: () => null },
                { key: 'shares', heading: 'Shares', numeric: true, cell: (h) => formatUnits(h.unitsMicro) },
                { key: 'avg', heading: 'Avg price', numeric: true, cell: (h) => formatPriceMicro(priceMicroFrom(h.costMinor, h.unitsMicro), h.currency) },
                { key: 'gain', heading: 'Gain', numeric: true, cell: (h) => { const bps = gainBps(h.valueMinor, h.costMinor); return bps === null ? '—' : formatBps(bps); } },
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
                // Read-only on purpose: a trade is changed only on Buy & sell (spec §9).
                destination={() => null}
                columns={[
                  { key: 'trade', heading: 'Trade', cell: () => null },
                  { key: 'where', heading: 'Kept at', cell: (line) => line.brokerName },
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
                                {line.pinnedRate !== null && <span className={cx('block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]')}>at {rateLine(line.pinnedRate, line.currency, base)}</span>}
                              </>
                            ),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
