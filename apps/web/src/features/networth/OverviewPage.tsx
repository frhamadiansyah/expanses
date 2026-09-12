import { balanceSheet, isoDate, lastNMonths, monthOf, type SheetGroup, type SheetTotals } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { HealthRatios } from './HealthRatios';
import { periodRange, type RatioPeriod } from './health-cards';
import { Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { NetWorthTabs } from './NetWorthTabs';
import { attentionItems, deltaSince, monthsSinceJanuary } from './overview-rows';
import { useGoalPlans } from '../goals/queries';
import { usePeopleDebts } from '../debts/queries';
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

function SheetColumn({ title, groups, totalMinor, currency }: { title: string; groups: SheetGroup[]; totalMinor: number; currency: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</span>
        <Money minor={totalMinor} currency={currency} className="font-semibold" />
      </div>
      <ShareBar groups={groups} totalMinor={totalMinor} />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {groups.map((group) => (
          <span key={group.key} className="flex items-center gap-1.5">
            <i className={`h-2 w-2 rounded-sm ${GROUP_COLORS[group.key] ?? 'bg-slate-400'}`} />
            {group.label} {totalMinor > 0 ? Math.round((group.totalMinor / totalMinor) * 100) : 0}%
          </span>
        ))}
      </div>
      <div>
        {groups.map((group) => (
          <div key={group.key} className="border-t border-slate-100 py-2 first:border-t-0">
            <div className="flex items-baseline justify-between gap-3 font-medium">
              <span>{group.label}</span>
              <Money minor={group.totalMinor} currency={currency} />
            </div>
            {group.rows.map((row) => (
              <div key={`${group.key}-${row.accountId}`} className="flex items-baseline justify-between gap-3 py-0.5 pl-4 text-sm text-slate-600">
                <span className="min-w-0">
                  {row.name}
                  {row.note && <span className="block text-xs text-slate-400">{row.note}</span>}
                </span>
                <Money minor={row.amountMinor} currency={currency} className="text-slate-900" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
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
  const goalSummary = useGoalPlans(today);

  const [period, setPeriod] = useState<RatioPeriod>({ key: 'ttm' });
  const range = periodRange(period, today);
  const flows = usePeriodFlows({ from: range.from, to: range.to });
  const periodSheetInputs = useSheet(range.balanceDate);

  const points = series.data ?? [];
  const sheet = balanceSheet(sheetInputs.data?.assets ?? [], sheetInputs.data?.liabilities ?? []);
  const attention = attentionItems(values.data ?? [], due.data ?? [], goalSummary.data?.plans ?? [], idle.data ?? [], [
    ...(people.data?.owedToYou ?? []),
    ...(people.data?.youOwe ?? []),
  ]);
  const sinceLastMonth = deltaSince(points, 1);
  const januaryMonths = monthsSinceJanuary(points);
  const sinceJanuary = januaryMonths === null ? null : deltaSince(points, januaryMonths);
  const periodSheet = balanceSheet(periodSheetInputs.data?.assets ?? [], periodSheetInputs.data?.liabilities ?? []);
  const groupTotal = (key: string) => periodSheet.assetGroups.find((group) => group.key === key)?.totalMinor ?? 0;
  const totals: SheetTotals = {
    liquidMinor: groupTotal('liquid'),
    investMinor: groupTotal('invest'),
    assetsMinor: periodSheet.assetsTotalMinor,
    liabilitiesMinor: periodSheet.liabilitiesTotalMinor,
    netWorthMinor: periodSheet.netWorthMinor,
  };
  const monthsWithData = flows.data?.months ?? 0;
  const monthsNote =
    monthsWithData === 0
      ? 'No transactions in this period yet, so the ratios that need cash flow stay empty.'
      : `${range.label}: ${monthsWithData === 1 ? '1 month' : `${monthsWithData} months`} of transactions, with balances as of ${range.balanceDate}.`;

  const nothingYet = series.isSuccess && sheetInputs.isSuccess && sheet.assetsTotalMinor === 0 && sheet.liabilitiesTotalMinor === 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Net worth" />
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

      <div className="grid gap-4 md:grid-cols-[1.7fr_1fr]">
        <Card className="space-y-3">
          <div>
            <div className="text-xs text-slate-500">Net worth</div>
            <div data-testid="net-worth" className="text-3xl font-semibold">
              <Money minor={sheet.netWorthMinor} currency={ws.baseCurrency} />
            </div>
            <div className="text-sm text-slate-500">
              {sinceLastMonth !== null && (
                <>
                  <Money minor={sinceLastMonth} currency={ws.baseCurrency} tone="auto" /> since last month
                </>
              )}
              {sinceJanuary !== null && (
                <>
                  {' · '}
                  <Money minor={sinceJanuary} currency={ws.baseCurrency} tone="auto" /> since January
                </>
              )}
            </div>
          </div>
          {points.length > 0 && <ValueChart values={points.map((point) => point.netWorthMinor)} labels={points.map((point) => MONTH_LABEL(point.month))} currency={ws.baseCurrency} />}
          <p className="text-xs text-slate-500">Month-end snapshots. Home and vehicles use your latest estimate; funds, shares and gold use the last price you entered.</p>
        </Card>

        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Needs attention</h2>
          {attention.length === 0 && <p className="text-sm text-slate-500">Nothing waiting. Prices and estimates are fresh.</p>}
          <div>
            {attention.map((item) => (
              <div key={item.key} className="flex items-start justify-between gap-3 border-t border-slate-100 py-2 text-sm first:border-t-0">
                <span className="flex gap-2">
                  <i className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.tone === 'warn' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                  {item.text}
                </span>
                <Link to={item.to} className="shrink-0 text-slate-600 underline">
                  {item.action}
                </Link>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Balance sheet</h2>
          <span className="text-xs text-slate-500">Assets at today's value · debts at what you still owe</span>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <SheetColumn title="What you own" groups={sheet.assetGroups} totalMinor={sheet.assetsTotalMinor} currency={ws.baseCurrency} />
          <SheetColumn
            title="What you owe"
            groups={[sheet.shortTerm, sheet.longTerm].filter((group) => group.rows.length > 0)}
            totalMinor={sheet.liabilitiesTotalMinor}
            currency={ws.baseCurrency}
          />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 font-medium">
          <span>
            Net worth = <Money minor={sheet.assetsTotalMinor} currency={ws.baseCurrency} /> − <Money minor={sheet.liabilitiesTotalMinor} currency={ws.baseCurrency} />
          </span>
          <Money minor={sheet.netWorthMinor} currency={ws.baseCurrency} />
        </div>
      </Card>

      <HealthRatios
        flows={flows.data}
        totals={totals}
        period={period}
        onPeriod={setPeriod}
        today={today}
        earliestYear={Number((points[0]?.month ?? today).slice(0, 4))}
        monthsNote={monthsNote}
      />
    </div>
  );
}
