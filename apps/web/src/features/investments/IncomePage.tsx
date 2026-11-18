import { type DividendMonth, formatMinor, isoDate } from '@expanses/core';
import { useId, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { BalanceCard } from '../accounts/BalanceCard';
import { ShareBar } from '../networth/ShareBar';
import { usePeriodFlows } from '../networth/queries';
import { IncomeBars } from './IncomeBars';
import { useIncomeYear } from './use-income-year';

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
 * One of the two figures inside the hero, under its bars: a small label in the quiet ink over the money, two to a row
 * — the shape an asset's card gives its four figures (`NumberGrid`). The figure is named by its label, as a read-only
 * row's is, so a screen reader (and a test) finds "Received this year" and hears its value.
 */
function Figure({ label, minor, currency }: { label: string; minor: number; currency: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <span id={id} className="block truncate text-[12px] leading-[16px] text-[var(--ph-ink-3)]">
        {label}
      </span>
      <span aria-labelledby={id} className="tabular block truncate text-[15px] leading-[20px] font-semibold text-[var(--ph-ink)]">
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
 * with this year's twelve months drawn under it — paid months in the tint, months still to come faint — and, in the
 * same card, what has been received this year and what is still to come, side by side. The card is drawn as every
 * card's figure is (`BalanceCard`), read from the left rather than centred (owner, 24 Oct). Then the two yields and
 * the share of a year's spending the income would cover; then who pays it. Each stock's history is Yahoo's, read once a day on this device;
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
  const { portfolio, isPending, error, trades, book, listed, bonds, bondIds, couponTerms, view, received } = useIncomeYear();
  const flows = usePeriodFlows({ from: shiftDays(today, -364), to: today });
  const [all, setAll] = useState(false);
  const [months, setMonths] = useState(false);

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
          {/*
           * The hero, as every figure in a card is drawn (Wallet's Balance, an asset's Value now): the label and the
           * year's figure from the left, the month under it, the twelve months it is spread over under a dashed rule,
           * and the year so far split in two under another — what has come in and what the pattern still owes.
           */}
          <BalanceCard
            label="A year, at today's holdings"
            minor={view.yearMinor}
            currency={base}
            series={null}
            testId="dividends-year"
            caption={`${formatMinor(Math.round(view.yearMinor / 12), base)} a month · estimate, before tax`}
            chart={<IncomeBars months={view.months} onOpen={() => setMonths(true)} />}
          >
            <div className="grid grid-cols-2 gap-x-4 border-t-[1px] border-dashed border-[var(--ph-hair)] pt-3">
              <Figure label="Received this year" minor={received} currency={base} />
              <Figure label="Still to come" minor={view.toComeMinor} currency={base} />
            </div>
          </BalanceCard>

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
              // Only a warning is said here: a holding with no dividend history is left out of the share.
              footer={view.unknown.length > 0 ? `No dividend history for ${view.unknown.join(', ')} yet, so it is not counted.` : undefined}
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
