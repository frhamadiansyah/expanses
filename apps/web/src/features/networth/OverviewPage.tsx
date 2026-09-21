import { balanceSheet, formatMinor, isoDate, lastNMonths, monthOf, type ScheduleRow, type SheetGroup } from '@expanses/core';
import { scheduleFor } from '@expanses/db';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { HealthRatios } from './HealthRatios';
import { periodRange, type RatioPeriod, ratioTotals } from './health-cards';
import { Empty, ErrorBox, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, SCREEN } from '../../ui/native';
import { NetWorthTabs } from './NetWorthTabs';
import { attentionItems, deltaSince, monthsSinceJanuary } from './overview-rows';
import { useGoalPlans } from '../goals/queries';
import { usePeopleDebts } from '../debts/queries';
import { loanAttention } from '../loans/attention';
import { useInstallments, useLoans } from '../loans/queries';
import { useAssetValues, useDueTemplates, useIdleCash, useNetWorthSeries, usePeriodFlows, useSheet } from './queries';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const GROUP_COLORS: Record<string, string> = {
  liquid: 'bg-cyan-600',
  invest: 'bg-emerald-600',
  owed: 'bg-indigo-500',
  use: 'bg-slate-400',
  short: 'bg-rose-500',
  long: 'bg-rose-800',
};

function ShareBar({ groups, totalMinor }: { groups: SheetGroup[]; totalMinor: number }) {
  if (totalMinor <= 0) return null;
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
      {groups.map((group) => (
        <span
          key={group.key}
          className={GROUP_COLORS[group.key] ?? 'bg-slate-400'}
          style={{ width: `${(group.totalMinor / totalMinor) * 100}%` }}
          title={`${group.label}: ${Math.round((group.totalMinor / totalMinor) * 100)}%`}
        />
      ))}
    </div>
  );
}

/**
 * One side of the balance sheet: its share bar and legend on a panel, then a group per plan group.
 *
 * Each group's label is its own header, outside and above its rows, rather than a heading line inside one long
 * card. The two columns stay two columns on a desktop — this and `/` are the only real grids in the app.
 */
function SheetColumn({ title, groups, totalMinor, currency }: { title: string; groups: SheetGroup[]; totalMinor: number; currency: string }) {
  return (
    <div>
      <PanelHeader title={title} trailing={<Money minor={totalMinor} currency={currency} />} />
      <Panel wide className="space-y-2">
        <ShareBar groups={groups} totalMinor={totalMinor} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--ph-ink-3)]">
          {groups.map((group) => (
            <span key={group.key} className="flex items-center gap-1.5">
              <i className={`h-2 w-2 rounded-sm ${GROUP_COLORS[group.key] ?? 'bg-slate-400'}`} />
              {group.label} {totalMinor > 0 ? Math.round((group.totalMinor / totalMinor) * 100) : 0}%
            </span>
          ))}
        </div>
      </Panel>
      {groups.map((group) =>
        group.rows.length === 0 ? (
          <PanelHeader key={group.key} title={group.label} trailing={<Money minor={group.totalMinor} currency={currency} />} />
        ) : (
          <InsetGroup key={group.key} wide header={group.label} trailing={<Money minor={group.totalMinor} currency={currency} />}>
            {group.rows.map((row) => (
              <InsetRow
                key={`${group.key}-${row.accountId}`}
                title={row.name}
                subtitle={row.note ?? undefined}
                value={<Money minor={row.amountMinor} currency={currency} />}
                valueTone="ink"
                chevron={false}
              />
            ))}
          </InsetGroup>
        ),
      )}
    </div>
  );
}

/** Each open loan's schedule, keyed by account, so the attention rows can read the next payment. */
function useLoanSchedules(loans: { accountId: string }[], today: string): Record<string, ScheduleRow[]> {
  const { database, ws } = useApp();
  const results = useQueries({
    queries: loans.map((loan) => ({
      queryKey: ['loan-schedule', ws.workspaceId, loan.accountId, today],
      queryFn: () => scheduleFor(database, ws, loan.accountId, today),
    })),
  });
  const byAccount: Record<string, ScheduleRow[]> = {};
  loans.forEach((loan, index) => {
    byAccount[loan.accountId] = (results[index]?.data as ScheduleRow[] | undefined) ?? [];
  });
  return byAccount;
}

export function OverviewPage() {
  const { ws } = useApp();
  const today = isoDate();
  const months = lastNMonths(monthOf(today), 12);
  const series = useNetWorthSeries(months);
  const sheetInputs = useSheet();
  const values = useAssetValues();
  const due = useDueTemplates();
  const idle = useIdleCash();
  const people = usePeopleDebts(today);
  const loans = useLoans();
  const installments = useInstallments();
  const schedules = useLoanSchedules(loans.data ?? [], today);
  const goalSummary = useGoalPlans(today);

  const [period, setPeriod] = useState<RatioPeriod>({ key: 'ttm' });
  const range = periodRange(period, today);
  const flows = usePeriodFlows({ from: range.from, to: range.to });
  const periodSheetInputs = useSheet(range.balanceDate);

  const points = series.data ?? [];
  // Every rate or no figure: a point, or the balance sheet, that lacks one names it instead of counting that money as 0.
  const charted = points.flatMap((point) => (point.netWorthMinor === null ? [] : [point.netWorthMinor]));
  // The hero is today's figure, so only today's missing rates hide it; an earlier month's hides that month's point.
  const sheetMissing = sheetInputs.data?.missing ?? [];
  const unchartable = [...new Set(points.flatMap((point) => point.missing))].sort();
  const sheet = balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? []);
  const attention = attentionItems(
    values.data ?? [],
    due.data ?? [],
    goalSummary.data?.plans ?? [],
    idle.data ?? [],
    [...(people.data?.owedToYou ?? []), ...(people.data?.youOwe ?? [])],
    (loans.data ?? []).map((loan) =>
      loanAttention(
        {
          loan,
          name: loan.lenderName,
          currency: ws.baseCurrency,
          schedule: schedules[loan.accountId] ?? [],
          installments: installments.data ?? [],
        },
        today,
      ),
    ),
  );
  const sinceLastMonth = deltaSince(points, 1);
  const januaryMonths = monthsSinceJanuary(points);
  const sinceJanuary = januaryMonths === null ? null : deltaSince(points, januaryMonths);
  // The ratios read the balance sheet on the period's balance date: every rate on that date, or no ratios.
  const periodTotals = ratioTotals(periodSheetInputs.data);
  const monthsWithData = flows.data?.months ?? 0;
  const monthsNote =
    monthsWithData === 0
      ? 'No transactions in this period yet, so the ratios that need cash flow stay empty.'
      : `${range.label}: ${monthsWithData === 1 ? '1 month' : `${monthsWithData} months`} of transactions, with balances as of ${range.balanceDate}.`;

  const nothingYet = series.isSuccess && sheetInputs.isSuccess && sheetMissing.length === 0 && sheet.assetsTotalMinor === 0 && sheet.liabilitiesTotalMinor === 0;

  return (
    <div className={SCREEN}>
      <LargeTitle title="Net worth" />
      <NetWorthTabs />
      <ErrorBox error={series.error ?? sheetInputs.error ?? values.error} />

      {nothingYet && (
        <Empty>
          Nothing to show yet. Add your accounts on{' '}
          <Link to="/accounts" className="font-medium underline">
            Accounts
          </Link>{' '}
          or an asset on the{' '}
          <Link to="/net-worth/assets" className="font-medium underline">
            Assets
          </Link>{' '}
          tab.
        </Empty>
      )}

      {/* The one real desktop grid in the app, kept: the figure and its year on the left, what waits on the right. */}
      <div className="grid gap-4 md:grid-cols-[1.7fr_1fr]">
        <Panel
          wide
          header="Net worth"
          footer="Month-end snapshots. Home and vehicles use your latest estimate; funds, shares and gold use the last price you entered."
        >
          <div data-testid="net-worth">
            {sheetMissing.length > 0 ? (
              <p className="py-6 text-center text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so net worth cannot be added up.</p>
            ) : (
            <Hero
              minor={sheet.netWorthMinor}
              currency={ws.baseCurrency}
              caption={
                <>
                  {sinceLastMonth !== null && <>{formatMinor(sinceLastMonth, ws.baseCurrency)} since last month</>}
                  {sinceJanuary !== null && <> · {formatMinor(sinceJanuary, ws.baseCurrency)} since January</>}
                </>
              }
            />
            )}
          </div>
          {points.length > 0 && charted.length === points.length && (
            <ValueChart values={charted} labels={points.map((point) => MONTH_LABEL(point.month))} currency={ws.baseCurrency} />
          )}
          {sheetMissing.length === 0 && unchartable.length > 0 && (
            <p data-testid="chart-missing" className="text-[13px] leading-[17px] text-[var(--ph-warn)]">No {unchartable.join(', ')} rate for an earlier month, so the year cannot be charted.</p>
          )}
        </Panel>

        <div>
          <PanelHeader title="Needs attention" />
          {attention.length === 0 ? (
            <Panel wide>
              <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing waiting. Prices and estimates are fresh.</p>
            </Panel>
          ) : (
            <InsetGroup wide>
              {attention.map((item) => (
                /* The row is the link it used to hold; what it was called stays, on the right, in the tint. */
                <InsetRow
                  key={item.key}
                  to={item.to}
                  title={item.text}
                  value={item.action}
                  valueTone={item.tone === 'warn' ? 'warn' : 'tint'}
                  chevron={false}
                />
              ))}
            </InsetGroup>
          )}
        </div>
      </div>

      <section className="mb-[18px]">
        <PanelHeader title="Balance sheet" />
        <p className="px-[4px] pb-[10px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Assets at today's value · debts at what you still owe</p>
        {/* A row with no rate reads 0 here, so its totals would be short: the missing rate is named instead. */}
        {sheetMissing.length > 0 ? (
          <Panel wide>
            <p data-testid="balance-sheet-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">No {sheetMissing.join(', ')} rate yet, so the balance sheet cannot be added up.</p>
          </Panel>
        ) : (
        <>
        <div className="grid gap-6 md:grid-cols-2">
          <SheetColumn title="What you own" groups={sheet.assetGroups} totalMinor={sheet.assetsTotalMinor} currency={ws.baseCurrency} />
          <SheetColumn
            title="What you owe"
            groups={[sheet.shortTerm, sheet.longTerm].filter((group) => group.rows.length > 0)}
            totalMinor={sheet.liabilitiesTotalMinor}
            currency={ws.baseCurrency}
          />
        </div>
        <Panel wide>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[15px] leading-[20px] font-medium">
            <span>
              Net worth = <Money minor={sheet.assetsTotalMinor} currency={ws.baseCurrency} /> − <Money minor={sheet.liabilitiesTotalMinor} currency={ws.baseCurrency} />
            </span>
            <Money minor={sheet.netWorthMinor} currency={ws.baseCurrency} />
          </div>
        </Panel>
        </>
        )}
      </section>

      <HealthRatios
        flows={flows.data}
        totals={periodTotals.totals}
        missing={periodTotals.missing}
        period={period}
        onPeriod={setPeriod}
        today={today}
        earliestYear={Number((points[0]?.month ?? today).slice(0, 4))}
        monthsNote={monthsNote}
      />
    </div>
  );
}
