import { couponDatesBetween, type DividendHolding, dividendView, type DividendView, formatMinor, holdingPositionAfter, isoDate, yahooSymbol } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { useMemo, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { ShareBar } from '../networth/ShareBar';
import { useAssetValues, useBondCoupons, usePeriodFlows, useTrades } from '../networth/queries';
import { useDividendHistory } from '../prices/yahoo';
import { usePortfolio } from './queries';

const BACK = { back: 'Investments', backTo: '/net-worth/investments' } as const;
/** How many payers get a row of their own before the rest fold into "others". */
const NAMED = 4;
/** The strip's colours, one per named payer, then the rest. Tailwind's scale is the kit's palette. */
const SWATCH = ['bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-violet-500'];
const REST_SWATCH = 'bg-slate-300';

const DAY = 86_400_000;
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const monthName = (month: number) => new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1)));
const percent = (bps: number | null) =>
  bps === null ? '—' : `${new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bps / 100)}%`;

function Swatch({ className }: { className: string }) {
  return <span aria-hidden className={`block h-2.5 w-2.5 rounded-full ${className}`} />;
}

/**
 * What the shares and bonds held today pay: a year of dividends and coupons, this year so far and still to come, the two yields, the share of
 * a year's spending it would cover, and who pays it. Each stock's history is Yahoo's, read once a day on this device.
 */
export function DividendsPage() {
  const { ws } = useApp();
  const base = ws.baseCurrency;
  const today = isoDate();
  const { view: portfolio, rates, securities, isPending, error } = usePortfolio();
  const trades = useTrades();
  const flows = usePeriodFlows({ from: shiftDays(today, -364), to: today });
  const [all, setAll] = useState(false);
  const [months, setMonths] = useState(false);

  // Only stocks Yahoo knows: a fund or a share named by hand has no ticker there.
  const listed = useMemo(() => {
    const byId = new Map(securities.map((s) => [s.id, s]));
    return (portfolio?.stocks ?? []).flatMap((row) => {
      const security = row.securityId ? byId.get(row.securityId) : undefined;
      return security && yahooSymbol(security) ? [{ row, security }] : [];
    });
  }, [portfolio, securities]);
  const history = useDividendHistory(listed.map((l) => l.security));
  // Bonds with coupon terms pay too: their schedule, from the terms on their Settings, on the par held each day.
  const couponTerms = useBondCoupons();
  const values = useAssetValues();
  const bonds = useMemo(
    () =>
      Object.values(couponTerms.data ?? {}).flatMap((term) => {
        const value = (values.data ?? []).find((row) => row.accountId === term.accountId);
        return value ? [{ term, value }] : [];
      }),
    [couponTerms.data, values.data],
  );
  const bondIds = useMemo(() => new Set(bonds.map((b) => b.term.accountId)), [bonds]);

  const view = useMemo((): DividendView | null => {
    if (!portfolio || !trades.data || !history.data) return null;
    const byAccount = new Map<string, TradeRow[]>();
    for (const trade of trades.data) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
    const holdings: DividendHolding[] = listed.map(({ row, security }) => ({
      securityId: security.id,
      title: row.title,
      currency: row.currency,
      unitsMicro: row.unitsMicro,
      unitsOn: (date) => row.holdings.reduce((sum, h) => sum + holdingPositionAfter(byAccount.get(h.accountId) ?? [], date).unitsMicro, 0),
      costBaseMinor: row.costBaseMinor,
      valueBaseMinor: row.valueBaseMinor,
      payments: history.data[security.id] ?? null,
    }));
    for (const { term, value } of bonds) {
      // A coupon per unit of par: the rate a year over the payments a year. Two years back and the year ahead cover
      // every reading the page makes — the last 12 months, this year and last.
      const perUnit = term.rateBps / 10_000 / term.perYear;
      const dates = couponDatesBetween({ nextOn: term.nextOn, perYear: term.perYear, payDay: term.payDay, maturesOn: term.maturesOn, from: shiftDays(today, -800), to: today });
      const own = byAccount.get(term.accountId) ?? [];
      holdings.push({
        securityId: term.accountId,
        title: value.name,
        currency: value.currency,
        unitsMicro: holdingPositionAfter(own, today).unitsMicro,
        unitsOn: (date) => holdingPositionAfter(own, date).unitsMicro,
        costBaseMinor: value.currency === base ? value.costMinor : null,
        valueBaseMinor: value.currency === base ? value.valueMinor : null,
        payments: dates.map((exDate) => ({ exDate, perShare: perUnit })),
      });
    }
    return dividendView({ holdings, today, baseCurrency: base, ratesToBase: rates });
  }, [portfolio, trades.data, history.data, listed, bonds, today, base, rates]);

  const spending = flows.data?.spendingMinor ?? null;
  const named = view ? (all ? view.payers : view.payers.slice(0, NAMED)) : [];
  const rest = view ? view.payers.slice(NAMED) : [];
  const restMinor = rest.reduce((sum, p) => sum + p.yearMinor, 0);

  return (
    <div className={SCREEN}>
      <LargeTitle title="Dividends" {...BACK} />
      <ErrorBox error={error ?? trades.error} />
      {portfolio && couponTerms.data && listed.length === 0 && bonds.length === 0 && (
        <Empty>No listed shares or bonds with a coupon yet. Dividends show here once a share with a ticker is held, and coupons once a bond's terms are set.</Empty>
      )}
      {listed.length + bonds.length > 0 && !view && <Empty>Reading dividend history…</Empty>}
      {view && listed.length + bonds.length > 0 && (
        <>
          <div data-testid="dividends-year">
            <Hero
              label="A year, at today's holdings"
              minor={view.yearMinor}
              currency={base}
              plain
              align="center"
              caption={`${formatMinor(Math.round(view.yearMinor / 12), base)} a month · estimate, before tax`}
            />
          </div>

          <InsetGroup>
            <ReadOnlyRow label="Received this year" value={formatMinor(view.receivedMinor, base)} />
            <InsetRow
              title="Still to come"
              subtitle={view.toComeMonths.length > 0 ? view.toComeMonths.map(monthName).join(', ') : undefined}
              value={formatMinor(view.toComeMinor, base)}
              valueTone="ink"
            />
          </InsetGroup>

          <InsetGroup>
            <ReadOnlyRow label="Yield on cost" value={percent(view.yieldOnCostBps)} />
            <ReadOnlyRow label="Yield at today's price" value={percent(view.yieldAtPriceBps)} />
            {spending !== null && spending > 0 && (
              <InsetRow
                title="Covers a year's spending"
                subtitle={`${formatMinor(spending, base)} spent in the last 12 months`}
                value={percent(Math.round((view.yearMinor * 10_000) / spending))}
                valueTone="ink"
              />
            )}
          </InsetGroup>

          {view.payers.length > 0 && (
            <InsetGroup
              header="Who pays it"
              footer={
                view.unknown.length > 0
                  ? `No dividend history for ${view.unknown.join(', ')} yet, so it is not counted.`
                  : "Each stock's dividends and each bond's coupons over the last 12 months, at what is held now."
              }
            >
              <div style={{ padding: '12px 16px 4px' }}>
                <ShareBar
                  totalMinor={view.yearMinor}
                  segments={[
                    ...view.payers.slice(0, NAMED).map((p, i) => ({ key: p.securityId, label: p.title, minor: p.yearMinor, className: SWATCH[i]! })),
                    ...(restMinor > 0 ? [{ key: 'rest', label: 'Others', minor: restMinor, className: REST_SWATCH }] : []),
                  ]}
                />
              </div>
              {named.map((p, i) => (
                <InsetRow
                  key={p.securityId}
                  testId="dividend-payer"
                  icon={<Swatch className={SWATCH[i] ?? REST_SWATCH} />}
                  title={p.title}
                  subtitle={`${p.percent}%`}
                  value={formatMinor(p.yearMinor, base)}
                  valueTone="ink"
                  // A bond's coupon opens the bond; a share's dividend, its stock.
                  {...(bondIds.has(p.securityId)
                    ? { to: '/net-worth/assets/$accountId' as const, params: { accountId: p.securityId } }
                    : { to: '/net-worth/investments/security/$securityId' as const, params: { securityId: p.securityId } })}
                />
              ))}
              {!all && rest.length > 0 && (
                <InsetRow
                  icon={<Swatch className={REST_SWATCH} />}
                  title={`${rest.length} ${rest.length === 1 ? 'other' : 'others'}`}
                  subtitle={`${rest.reduce((sum, p) => sum + p.percent, 0)}%`}
                  value={formatMinor(restMinor, base)}
                  valueTone="ink"
                  onClick={() => setAll(true)}
                />
              )}
            </InsetGroup>
          )}
          {view.payers.length === 0 && view.unknown.length > 0 && <Empty>No dividend history could be read for {view.unknown.join(', ')}.</Empty>}

          <InsetGroup>
            <InsetRow title="Month by month" onClick={() => setMonths(true)} />
          </InsetGroup>
          {months && (
            <Sheet title="Month by month" grouped onClose={() => setMonths(false)}>
              <InsetGroup footer="By ex-dividend month, from the last 12 months at the shares held now.">
                {view.months.map((m) => (
                  <InsetRow
                    key={m.month}
                    title={monthName(m.month)}
                    subtitle={m.titles.length > 0 ? m.titles.join(', ') : undefined}
                    value={m.minor > 0 ? formatMinor(m.minor, base) : '—'}
                    valueTone={m.minor > 0 ? 'ink' : 'ink-3'}
                  />
                ))}
              </InsetGroup>
            </Sheet>
          )}
        </>
      )}
      {isPending && !error && <Empty>Loading…</Empty>}
    </div>
  );
}
