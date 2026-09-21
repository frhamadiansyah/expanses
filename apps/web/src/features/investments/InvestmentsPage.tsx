import { formatBps, formatLots, formatMinor } from '@expanses/core';
import { usePhone } from '../../app/use-phone';
import { useApp } from '../../app/context';
import { cx, Empty, ErrorBox } from '../../ui';
import { ApproxFigure, approxLine, Figure, groupedFigure, GroupedRow, Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { type Destination, DesktopBand, InBase, InvestTable } from './InvestTable';
import { type BrokerRow, brokerSubtitle, keptAt, type PortfolioView, putInLine, type StockRow, stockSubtitle } from './portfolio-view';
import { usePortfolio } from './queries';

type Rates = Readonly<Record<string, number>>;

/** A stock opens its own page; a holding not linked to a security opens the asset page it has always had. */
const stockTo = (row: StockRow): Destination =>
  row.securityId
    ? { to: '/net-worth/investments/security/$securityId', params: { securityId: row.securityId } }
    : { to: '/net-worth/assets/$accountId', params: { accountId: row.accountId! } };

const brokerTo = (row: BrokerRow): Destination =>
  row.accountId ? { to: '/net-worth/investments/broker/$accountId', params: { accountId: row.accountId } } : { to: '/net-worth/investments/broker/none' };

/** The figure the page is for: the portfolio in base, ≈ when any of it is converted — or the missing rate named. */
function PortfolioFigure({ view, base, left }: { view: PortfolioView; base: string; left: boolean }) {
  const { summary } = view;
  return (
    <div data-testid="portfolio-total">
      {summary.valueBaseMinor !== null ? (
        <Hero
          minor={summary.valueBaseMinor}
          currency={base}
          align={left ? 'start' : 'center'}
          caption={
            <span data-testid="portfolio-caption">
              {summary.gainBaseMinor === null ? (
                // What was put in is not known for a holding, so there is no gain to show — never one against a zero.
                'Gain not known'
              ) : (
                <>
                  {summary.converted ? '≈ ' : ''}
                  {formatMinor(summary.gainBaseMinor, base)}
                  {summary.gainBps === null ? '' : ` · ${formatBps(summary.gainBps)} in ${base}`}
                </>
              )}
              {summary.currencyMoveMinor !== null && summary.currencyMoveMinor !== 0 && (
                <span className="block">{formatMinor(summary.currencyMoveMinor, base)} of that is exchange-rate movement</span>
              )}
            </span>
          }
        />
      ) : (
        // The Assets page's own words when a rate is missing: no partial total, every figure below exact.
        <div className={cx('flex flex-col', left ? 'items-start text-left' : 'items-center text-center')} style={{ marginBottom: 18 }}>
          <p className="text-[22px] leading-[28px] font-extrabold tracking-[-0.03em] text-[var(--ph-warn)]">No {summary.missingRates.join(', ')} rate yet</p>
          <p className="mt-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">so your investments can't be added up. Each figure below is exact.</p>
        </div>
      )}
    </div>
  );
}

/** What was put in (pinned on each buy's day, so it needs no rate) and how many stocks and brokers. */
function PortfolioFacts({ view, base }: { view: PortfolioView; base: string }) {
  const brokers = view.brokers.filter((b) => b.accountId).length;
  return (
    <InsetGroup>
      <ReadOnlyRow label="Put in" value={putInLine(view.summary.costBaseMinor, view.costUnknown, base)} />
      <ReadOnlyRow
        label="Holdings"
        value={`${view.stocks.length} ${view.stocks.length === 1 ? 'stock' : 'stocks'} · ${brokers} ${brokers === 1 ? 'broker' : 'brokers'}`}
      />
    </InsetGroup>
  );
}

/** The phone: each stock and each broker a row, its own currency leading and the ≈ line beneath (R1). */
function PhoneLists({ view, base, rates }: { view: PortfolioView; base: string; rates: Rates }) {
  return (
    <>
      <InsetGroup header="By stock">
        {view.stocks.map((row) => (
          <InsetRow
            key={row.key}
            testId="stock-row"
            title={row.title}
            subtitle={stockSubtitle(row)}
            value={<ApproxFigure figure={formatMinor(row.valueMinor, row.currency)} beneath={approxLine(row.valueMinor, row.currency, base, rates)} />}
            valueTone={row.stale ? 'warn' : 'ink'}
            {...stockTo(row)}
          />
        ))}
      </InsetGroup>
      <InsetGroup header="Where they are kept">
        {view.brokers.map((row) =>
          // Two currencies at one broker: a parent that adds its children up, exactly as a row of pockets.
          row.currency === null ? (
            <GroupedRow key={row.key} testId="broker-row" title={row.name} subtitle={brokerSubtitle(row)} figure={groupedFigure(row.total, base)} {...brokerTo(row)} />
          ) : (
            <InsetRow
              key={row.key}
              testId="broker-row"
              title={row.name}
              subtitle={brokerSubtitle(row)}
              value={<ApproxFigure figure={formatMinor(row.valueMinor!, row.currency)} beneath={approxLine(row.valueMinor!, row.currency, base, rates)} />}
              valueTone="ink"
              {...brokerTo(row)}
            />
          ),
        )}
      </InsetGroup>
    </>
  );
}

/** The desktop: the same two lists as tables, every figure in its own column — the paid tier keeps them all. */
function DesktopTables({ view, base, rates }: { view: PortfolioView; base: string; rates: Rates }) {
  return (
    <>
      <InvestTable<StockRow>
        header="By stock"
        testId="stocks-table"
        rowTestId="stock-row"
        records={view.stocks}
        rowKey={(row) => row.key}
        title={(row) => row.title}
        destination={stockTo}
        columns={[
          { key: 'stock', heading: 'Stock', cell: (row) => (row.name !== row.title ? <span className="block text-[12.5px] leading-[16px]">{row.name}</span> : null) },
          { key: 'kept', heading: 'Kept at', cell: keptAt },
          { key: 'shares', heading: 'Shares', numeric: true, cell: (row) => formatLots(row.unitsMicro, row.lotSize ?? 1) },
          {
            key: 'gain',
            heading: 'Gain',
            numeric: true,
            cell: (row) => (
              <>
                {row.gainBps === null ? '—' : formatBps(row.gainBps)}
                {row.stale && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-warn)]">Update price</span>}
              </>
            ),
          },
          { key: 'value', heading: 'Value', numeric: true, cell: (row) => <Figure tone={row.stale ? 'warn' : 'ink'}>{formatMinor(row.valueMinor, row.currency)}</Figure> },
          { key: 'base', heading: `In ${base}`, numeric: true, cell: (row) => <InBase minor={row.valueMinor} currency={row.currency} base={base} rates={rates} /> },
        ]}
      />
      <InvestTable<BrokerRow>
        header="Where they are kept"
        testId="brokers-table"
        rowTestId="broker-row"
        records={view.brokers}
        rowKey={(row) => row.key}
        title={(row) => row.name}
        destination={brokerTo}
        columns={[
          { key: 'broker', heading: 'Broker', cell: () => null },
          { key: 'holdings', heading: 'Holdings', numeric: true, cell: (row) => row.holdings.length },
          { key: 'share', heading: 'Share', numeric: true, cell: (row) => (row.sharePercent === null ? '—' : `${row.sharePercent}%`) },
          // One currency: its own total. Two: no own-currency figure exists, so the cell says so rather than add them.
          { key: 'value', heading: 'Value', numeric: true, cell: (row) => (row.currency === null ? <Figure tone="ink-3">Two currencies</Figure> : formatMinor(row.valueMinor!, row.currency)) },
          {
            key: 'base',
            heading: `In ${base}`,
            numeric: true,
            cell: (row) => {
              if (row.currency !== null) return <InBase minor={row.valueMinor!} currency={row.currency} base={base} rates={rates} />;
              const figure = groupedFigure(row.total, base);
              return <Figure tone={figure.complete ? 'ink' : 'warn'}>{figure.text}</Figure>;
            },
          },
        ]}
      />
    </>
  );
}

/** The Assets page's Investments group, read by stock and by broker. Reached from Assets and from Buy & sell. */
export function InvestmentsPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const { view, rates, isPending, error } = usePortfolio();
  const base = ws.baseCurrency;
  const any = view !== null && view.stocks.length > 0;
  return (
    <div className={SCREEN}>
      {/* No NetWorthTabs: this is pushed from Assets with a back line, like an asset's own page. */}
      <LargeTitle title="Investments" back="Assets" backTo="/net-worth/assets" />
      <ErrorBox error={error} />
      {view && !any && <Empty>No shares or funds yet. Add a listed share or a fund on Assets to see it here.</Empty>}
      {view && any && phone && (
        <>
          <PortfolioFigure view={view} base={base} left={false} />
          <PortfolioFacts view={view} base={base} />
          <PhoneLists view={view} base={base} rates={rates} />
        </>
      )}
      {view && any && !phone && (
        <>
          <DesktopBand figure={<PortfolioFigure view={view} base={base} left />} facts={<PortfolioFacts view={view} base={base} />} />
          <DesktopTables view={view} base={base} rates={rates} />
        </>
      )}
      {isPending && !error && <Empty>Loading…</Empty>}
    </div>
  );
}
