import { formatBps, formatMinor, formatUnits, gainBps } from '@expanses/core';
import { useParams } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useBalances } from '../../lib/queries';
import { cx, Empty, ErrorBox } from '../../ui';
import { ApproxFigure, approxLine, Figure, groupedFigure, Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { type Destination, DesktopBand, InBase, InvestTable } from './InvestTable';
import { type BrokerRow, NO_BROKER, putInLine } from './portfolio-view';
import { usePortfolio } from './queries';
import { brokerPageModel, type BrokerHoldingRow } from './security-view';

type Rates = Readonly<Record<string, number>>;

const BACK = { back: 'Investments', backTo: '/net-worth/investments' } as const;

/** The broker's total: in its own currency when every holding shares it, else ≈ in base, else the missing rate named. */
function Total({ broker, base, rates, left }: { broker: BrokerRow; base: string; rates: Rates; left: boolean }) {
  const align = left ? 'start' : 'center';
  if (broker.currency !== null)
    return <Hero minor={broker.valueMinor!} currency={broker.currency} align={align} caption={approxLine(broker.valueMinor!, broker.currency, base, rates) ?? undefined} />;
  if (broker.total.totalMinor !== null) return <Hero minor={broker.total.totalMinor} currency={base} align={align} caption="≈ Converted at today’s rates" />;
  return (
    <div className={cx('flex flex-col', left ? 'items-start text-left' : 'items-center text-center')} style={{ marginBottom: 18 }}>
      <p className="text-[22px] leading-[28px] font-extrabold tracking-[-0.03em] text-[var(--ph-warn)]">{groupedFigure(broker.total, base).text}</p>
      <p className="mt-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">so the holdings here can't be added up. Each figure below is exact.</p>
    </div>
  );
}

export function BrokerPage({ none = false }: { none?: boolean }) {
  const { ws } = useApp();
  const phone = usePhone();
  const { accountId } = useParams({ strict: false }) as { accountId?: string };
  const { view, rates, accounts, isPending, error } = usePortfolio();
  const balances = useBalances();
  const key = none ? NO_BROKER : (accountId ?? '');
  const base = ws.baseCurrency;
  const model = view ? brokerPageModel({ view, key, accounts, balances: balances.data, base }) : null;
  if (!model) {
    const name = none ? 'No broker named' : (accounts.find((a) => a.id === accountId)?.name ?? 'Broker');
    return (
      <div className={SCREEN}>
        <LargeTitle title={name} {...BACK} oneLine />
        <ErrorBox error={error} />
        {!isPending && !error && <Empty>Nothing is held here now.</Empty>}
      </div>
    );
  }
  const { broker, cash, rows } = model;
  const holdingTo = ({ opens }: BrokerHoldingRow): Destination =>
    'securityId' in opens
      ? { to: '/net-worth/investments/security/$securityId', params: { securityId: opens.securityId } }
      : { to: '/net-worth/assets/$accountId', params: { accountId: opens.accountId } };

  const figure = (
    <div data-testid="broker-total">
      <Total broker={broker} base={base} rates={rates} left={!phone} />
    </div>
  );
  const facts = (
    <InsetGroup footer="A broker in one currency shows its own totals in that currency. Nothing is converted twice.">
      <ReadOnlyRow label="Put in" value={putInLine(broker.costBaseMinor, broker.holdings.filter((h) => h.costBaseMinor === null).map((h) => h.name), base)} />
      {cash.map((c) => (
        // Each in its own currency, never converted: idle cash is a balance, not a value.
        <ReadOnlyRow key={c.accountId} label={c.label} value={formatMinor(c.minor, c.currency)} />
      ))}
    </InsetGroup>
  );

  return (
    <div className={SCREEN}>
      <LargeTitle title={broker.currency ? `${broker.name} · ${broker.currency}` : broker.name} {...BACK} oneLine />
      <ErrorBox error={error ?? balances.error} />
      {phone ? (
        <>
          {figure}
          {facts}
          <InsetGroup header="Holdings here">
            {rows.map((row) => {
              const h = row.holding;
              const bps = gainBps(h.valueMinor, h.costMinor);
              return (
                <InsetRow
                  key={h.accountId}
                  testId="broker-holding-row"
                  title={row.title}
                  subtitle={`${formatUnits(h.unitsMicro)} shares${bps === null ? '' : ` · ${formatBps(bps)}`}`}
                  // A one-currency broker's ≈ is carried once, by its total; a mixed one's by each holding.
                  value={<ApproxFigure figure={formatMinor(h.valueMinor, h.currency)} beneath={broker.currency === null ? approxLine(h.valueMinor, h.currency, base, rates) : null} />}
                  valueTone={h.stale ? 'warn' : 'ink'}
                  {...holdingTo(row)}
                />
              );
            })}
          </InsetGroup>
        </>
      ) : (
        <>
          <DesktopBand figure={figure} facts={facts} />
          <div>
            <InvestTable<BrokerHoldingRow>
              header="Holdings here"
              testId="broker-holdings-table"
              rowTestId="broker-holding-row"
              records={rows}
              rowKey={(row) => row.holding.accountId}
              title={(row) => row.title}
              destination={holdingTo}
              columns={[
                { key: 'stock', heading: 'Stock', cell: () => null },
                { key: 'shares', heading: 'Shares', numeric: true, cell: ({ holding: h }) => formatUnits(h.unitsMicro) },
                { key: 'gain', heading: 'Gain', numeric: true, cell: ({ holding: h }) => { const bps = gainBps(h.valueMinor, h.costMinor); return bps === null ? '—' : formatBps(bps); } },
                { key: 'value', heading: 'Value', numeric: true, cell: ({ holding: h }) => <Figure tone={h.stale ? 'warn' : 'ink'}>{formatMinor(h.valueMinor, h.currency)}</Figure> },
                ...(broker.currency === null
                  ? [{ key: 'base', heading: `In ${base}`, numeric: true, cell: ({ holding: h }: BrokerHoldingRow) => <InBase minor={h.valueMinor} currency={h.currency} base={base} rates={rates} /> }]
                  : []),
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
