import { couponDatesBetween, type DividendHolding, type DividendMonth, dividendView, type DividendView, formatMinor, holdingPositionAfter, isoDate, sumToBase, yahooSymbol } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { useId, useMemo, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { GROUP_RADIUS, Hero, InsetGroup, InsetRow, Panel, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { ShareBar } from '../networth/ShareBar';
import { useAssetValues, useBondCoupons, usePeriodFlows, useTrades } from '../networth/queries';
import { useDividendHistory } from '../prices/yahoo';
import { IncomeBars } from './IncomeBars';
import { receivedThisYear } from './income-year';
import { useTradeBook } from './IncomeTrades';
import { usePortfolio } from './queries';

const BACK = { back: 'Assets', backTo: '/net-worth/assets' } as const;
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
 * One of the two figures under the hero, side by side: a small label in the quiet ink over the money in bold, on the
 * group's own surface — the shape a card's Owed tile takes. The figure is named by its label, as a read-only row's is,
 * so a screen reader (and a test) finds "Received this year" and hears its value.
 */
function Tile({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  const id = useId();
  return (
    <div className="min-w-0 bg-[var(--ph-surface)] px-[13px] py-[10px]" style={{ borderRadius: GROUP_RADIUS }}>
      <span id={id} className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        {label}
      </span>
      <span aria-labelledby={id} className="tabular block truncate text-[19px] leading-[24px] font-bold tracking-[-0.01em] text-[var(--ph-ink)]">
        {formatMinor(minor, currency)}
      </span>
    </div>
  );
}

/** A month's line in the sheet: what it paid in the ink, or what it still owes in the quiet ink, and who. */
function monthLine(m: DividendMonth, currency: string): { subtitle?: string; value: string; tone: 'ink' | 'ink-3' } {
  const who = m.titles.join(', ');
  if (m.paidMinor > 0) {
    const owed = m.toComeMinor > 0 ? `${formatMinor(m.toComeMinor, currency)} still to come` : '';
    return { subtitle: [who, owed].filter(Boolean).join(' · ') || undefined, value: formatMinor(m.paidMinor, currency), tone: 'ink' };
  }
  if (m.toComeMinor > 0) return { subtitle: `${who} · still to come`, value: formatMinor(m.toComeMinor, currency), tone: 'ink-3' };
  return { value: '—', tone: 'ink-3' };
}

/**
 * Income: what the shares and bonds held today pay. The hero is a year of dividends and coupons at today's holdings,
 * with this year's twelve months drawn under it — paid months in the tint, months still to come faint. Under it, what
 * has been received this year and what is still to come, side by side; then the two yields and the share of a year's
 * spending the income would cover; then who pays it. Each stock's history is Yahoo's, read once a day on this device;
 * a bond's coupons come from the terms on its Settings.
 *
 * The year's two trade figures that opened this page (what the sells realized, what was recorded as paid) left with
 * the redesign (owner, 23 Oct): Realized this year is All trades', off Assets, and what was recorded as paid is folded
 * into Received this year rather than shown twice.
 */
export function IncomePage() {
  const { ws } = useApp();
  const base = ws.baseCurrency;
  const today = isoDate();
  const { view: portfolio, rates, securities, isPending, error } = usePortfolio();
  const trades = useTrades();
  const book = useTradeBook();
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

  /*
   * Received this year: the history's estimate, reconciled with what was recorded as paid on each holding since
   * 1 January (`receivedThisYear` says how). A recorded payment is in the holding's currency; it is brought to base
   * at the page's rates, and one whose currency has no rate is left out rather than summed unconverted.
   */
  const received = useMemo(() => {
    if (!view) return null;
    const recorded: Record<string, number> = {};
    for (const holding of book.holdings) {
      const minor = book.year[holding.accountId]?.incomeMinor ?? 0;
      if (minor === 0) continue;
      const inBase = sumToBase({ amounts: [{ minor, currency: holding.currency }], baseCurrency: base, ratesToBase: rates }).totalMinor;
      if (inBase !== null) recorded[holding.accountId] = inBase;
    }
    const estimated = [
      ...listed.map(({ row, security }) => ({ accountIds: row.holdings.map((h) => h.accountId), minor: view.receivedBy[security.id] ?? 0 })),
      ...bonds.map(({ term }) => ({ accountIds: [term.accountId], minor: view.receivedBy[term.accountId] ?? 0 })),
    ];
    return receivedThisYear(estimated, recorded);
  }, [view, book.holdings, book.year, listed, bonds, base, rates]);

  const spending = flows.data?.spendingMinor ?? null;
  const named = view ? (all ? view.payers : view.payers.slice(0, NAMED)) : [];
  const rest = view ? view.payers.slice(NAMED) : [];
  const restMinor = rest.reduce((sum, p) => sum + p.yearMinor, 0);

  return (
    <div className={SCREEN}>
      <PushedTitle title="Income" {...BACK} />
      <ErrorBox error={error ?? trades.error ?? book.values.error} />
      {portfolio && couponTerms.data && listed.length === 0 && bonds.length === 0 && (
        <Empty>No listed shares or bonds with a coupon yet. Dividends show here once a share with a ticker is held, and coupons once a bond's terms are set.</Empty>
      )}
      {listed.length + bonds.length > 0 && !view && <Empty>Reading dividend history…</Empty>}
      {view && received !== null && listed.length + bonds.length > 0 && (
        <>
          {/* The hero card: the year's figure, and under it the twelve months it is spread over. */}
          <Panel testId="dividends-year">
            <Hero
              label="A year, at today's holdings"
              minor={view.yearMinor}
              currency={base}
              plain
              align="center"
              caption={`${formatMinor(Math.round(view.yearMinor / 12), base)} a month · estimate, before tax`}
            />
            <IncomeBars months={view.months} onOpen={() => setMonths(true)} />
          </Panel>

          {/* The year so far, split in two: what has come in and what the pattern still owes. */}
          <div className="grid grid-cols-2 gap-3 md:max-w-2xl" style={{ marginBottom: 18 }}>
            <Tile label="Received this year" minor={received} currency={base} />
            <Tile label="Still to come" minor={view.toComeMinor} currency={base} />
          </div>

          <InsetGroup>
            <ReadOnlyRow label="Yield on cost" value={percent(view.yieldOnCostBps)} />
            <ReadOnlyRow label="Yield at today's price" value={percent(view.yieldAtPriceBps)} />
            {spending !== null && spending > 0 && (
              <ReadOnlyRow
                label="Covers a year's spending"
                value={percent(Math.round((view.yearMinor * 10_000) / spending))}
                info={`${formatMinor(spending, base)} spent in the last 12 months`}
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

          {/* Behind the bars: each month named, with who pays in it and its figure, which twelve bars cannot carry. */}
          {months && (
            <Sheet title="Month by month" grouped onClose={() => setMonths(false)}>
              <InsetGroup footer="By ex-dividend month, this year: what each has paid at the shares held then, and what it still owes from last year's pattern at the shares held now.">
                {view.months.map((m) => {
                  const line = monthLine(m, base);
                  return <InsetRow key={m.month} title={monthName(m.month)} subtitle={line.subtitle} value={line.value} valueTone={line.tone} />;
                })}
              </InsetGroup>
            </Sheet>
          )}
        </>
      )}
      {isPending && !error && <Empty>Loading…</Empty>}
    </div>
  );
}
