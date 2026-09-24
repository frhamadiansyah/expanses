import { addMonths, balanceSheet, displayAmount, formatMinor, isoDate, lastNMonths, monthOf, monthRange, type ScheduleRow, type SheetGroup } from '@expanses/core';
import { categoryTotalsBetween, expiringSoonAcross, nativeBalances, ownerScope, scheduleFor } from '@expanses/db';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Gauge } from 'lucide-react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox, Money } from '../../ui';
import { type CornerAction, Hero, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, SCREEN } from '../../ui/native';
import { NetWorthTabs } from './NetWorthTabs';
import { attentionItems, deltaSince, monthsSinceJanuary } from './overview-rows';
import { ShareBar, ShareLegend } from './ShareBar';
import { useGoalPlans, useSetAsideViews } from '../goals/queries';
import { usePeopleDebts } from '../debts/queries';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { loanAttention } from '../loans/attention';
import { useInstallments, useLoans } from '../loans/queries';
import { useAssetValues, useDueTemplates, useIdleCash, useNetWorthSeries, useSheet } from './queries';
import { ValueChart } from './ValueChart';

const MONTH_LABEL = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });
const sum = (rows: { amountBaseMinor: number }[]) => rows.reduce((total, row) => total + row.amountBaseMinor, 0);
const GROUP_COLORS: Record<string, string> = {
  liquid: 'bg-cyan-600',
  invest: 'bg-emerald-600',
  owed: 'bg-indigo-500',
  use: 'bg-slate-400',
  short: 'bg-rose-500',
  long: 'bg-rose-800',
};

/**
 * One side of the balance sheet: its share bar and legend on a panel, then a group per plan group.
 *
 * Each group's label is its own header, outside and above its rows, rather than a heading line inside one long
 * card. The two columns stay two columns on a desktop — this and `/` are the only real grids in the app.
 */
function SheetColumn({ title, groups, totalMinor, currency }: { title: string; groups: SheetGroup[]; totalMinor: number; currency: string }) {
  const segments = groups.map((group) => ({ key: group.key, label: group.label, minor: group.totalMinor, className: GROUP_COLORS[group.key] ?? 'bg-slate-400' }));
  return (
    // `min-w-0`: a column in a grid is as wide as its widest row unless it is told it may be narrower, and a row whose
    // title truncates is still as wide as the whole title — which is what pushed this page sideways.
    <div className="min-w-0">
      <PanelHeader title={title} trailing={<Money minor={totalMinor} currency={currency} />} />
      <Panel wide className="space-y-2">
        <ShareBar segments={segments} totalMinor={totalMinor} />
        <ShareLegend segments={segments} totalMinor={totalMinor} />
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
  const { database, ws } = useApp();
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
  const setAsideViews = useSetAsideViews();

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
    Object.values(setAsideViews.data ?? {}),
  );
  const sinceLastMonth = deltaSince(points, 1);
  const januaryMonths = monthsSinceJanuary(points);
  const sinceJanuary = januaryMonths === null ? null : deltaSince(points, januaryMonths);
  /*
   * The ratios are a screen of their own now, behind the corner glyph: a question of how you are doing rather than
   * what you have, and the period they are read over belongs to that screen with them.
   */
  const actions: CornerAction[] = [{ key: 'health', label: 'Financial health', glyph: <Gauge size={18} aria-hidden />, to: '/net-worth/health' }];

  const nothingYet = series.isSuccess && sheetInputs.isSuccess && sheetMissing.length === 0 && sheet.assetsTotalMinor === 0 && sheet.liabilitiesTotalMinor === 0;

  /*
   * What the Dashboard drew, on the same page: the month's two figures, what the cards owe, and the lines that say
   * something needs doing. Net worth is one subject, so it is one screen — the figure, the year behind it, the
   * balance sheet under it, the ratios beside it, and what the month and the cards have done to it.
   */
  const accounts = useAccounts();
  const money = (accounts.data ?? []).filter(isMoneyAccount);
  const cards = money.filter((account) => account.subtype === 'credit_card');
  const resolveRates = useResolveRates();
  const thisMonth = monthOf(today);

  const balances = useQuery({
    queryKey: ['net-worth-balances', ws.workspaceId, today, money.length],
    enabled: accounts.isSuccess,
    queryFn: async () => {
      const rows = await nativeBalances(database, ws);
      // The rates are read here only for whether they have gone stale: the figures themselves are the sheet's.
      const rates = await resolveRates(money.map((account) => account.currency!), today);
      return { rows, stale: rates.stale };
    },
  });

  const monthFlows = useQuery({
    queryKey: ['month-flows', ws.workspaceId, thisMonth],
    queryFn: async () => {
      const current = monthRange(thisMonth);
      const previous = monthRange(addMonths(thisMonth, -1));
      // The owner's own spending and income: every book together, as net worth itself is.
      const owner = ownerScope(ws);
      return {
        spending: sum(await categoryTotalsBetween(database, owner, 'expense', current.from, current.to, { billMonths: true })),
        income: sum(await categoryTotalsBetween(database, owner, 'income', current.from, current.to)),
        lastSpending: sum(await categoryTotalsBetween(database, owner, 'expense', previous.from, previous.to, { billMonths: true })),
      };
    },
  });

  // Reporting only: dead points are written off when a card is opened, never by looking at a summary.
  const expiring = useQuery({ queryKey: ['points-expiring', ws.workspaceId, today], queryFn: () => expiringSoonAcross(database, ws, today) });

  /*
   * A rate that has gone stale, and points about to lapse. A *missing* rate is not among them: the hero and the
   * chart already name every rate they lack, and saying the same thing twice reads as two problems.
   */
  const warnings = [
    ...(balances.data?.stale ?? []).map((currency) => `${currency} rate is out of date`),
    ...(expiring.data ?? []).map((row) => `${row.expiringSoon.toLocaleString('id-ID')} ${row.unit} on ${row.cardName} expire on ${row.nextExpiryOn}`),
  ];

  /*
   * With no money accounts and nothing on the sheet there is nothing to add up, so the screen asks for the two things
   * it reads rather than drawing a page of zeroes. Assets on their own still get the page below.
   */
  if (accounts.isSuccess && money.length === 0 && nothingYet) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Net worth" />
        <NetWorthTabs />
        <Panel wide>
          <Empty>
            Start by adding your bank accounts and credit cards on the{' '}
            <Link to="/accounts" className="font-medium underline">
              Accounts
            </Link>{' '}
            page.
          </Empty>
        </Panel>
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <LargeTitle title="Net worth" actions={actions} />
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
        {/*
         * `min-w-0` on both columns, and the same on the two balance-sheet columns: a grid item is as wide as its
         * widest row unless it is told it may be narrower, and a row title that truncates still measures as the whole
         * title — so "CIMB Niaga World ALL Accor" beside its figure set the page's minimum width and everything from
         * the section row to the chart scrolled sideways with it.
         */}
        <div className="min-w-0">
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
        </div>

        <div className="min-w-0">
          <PanelHeader title="Needs attention" />
          {attention.length === 0 && warnings.length === 0 ? (
            <Panel wide>
              <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Nothing waiting. Prices and estimates are fresh.</p>
            </Panel>
          ) : (
            <>
              {attention.length > 0 && (
                <InsetGroup wide>
                  {attention.map((item) => (
                    /* The row is the link it used to hold; what it was called stays, on the right, in the tint. */
                    <InsetRow
                      key={item.key}
                      to={item.to}
                      params={item.params}
                      title={item.text}
                      value={item.action}
                      valueTone={item.tone === 'warn' ? 'warn' : 'tint'}
                      chevron={false}
                    />
                  ))}
                </InsetGroup>
              )}
              {/*
               * The Dashboard's two lines, which the attention rows cannot hold: neither is a row with a screen
               * behind it — one is a rate to refresh, the other points that will lapse on a day.
               */}
              {warnings.length > 0 && (
                <div className="px-[4px] pt-[8px]">
                  {warnings.map((warning) => (
                    <p key={warning} className="pb-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          {/* What the month has done, and what the cards still owe: the Dashboard's own two questions, kept. */}
          <InsetGroup wide header="This month">
            <InsetRow
              title="Spent"
              subtitle={monthFlows.data ? <>Last month <Money minor={monthFlows.data.lastSpending} currency={ws.baseCurrency} /></> : undefined}
              value={monthFlows.data ? <Money minor={monthFlows.data.spending} currency={ws.baseCurrency} /> : '…'}
              valueTone="alarm"
              chevron={false}
            />
            <InsetRow
              title="Income"
              value={monthFlows.data ? <Money minor={monthFlows.data.income} currency={ws.baseCurrency} /> : '…'}
              valueTone="ink"
              chevron={false}
            />
          </InsetGroup>

          {cards.length > 0 && (
            <InsetGroup wide header="Credit cards owed">
              {cards.map((card) => (
                /* The line is the link: it lands on that card's own transactions. */
                <InsetRow
                  key={card.id}
                  to="/transactions"
                  search={{ account: card.id }}
                  title={card.name}
                  value={<Money minor={displayAmount('liability', balances.data?.rows[card.id] ?? 0)} currency={card.currency!} />}
                  valueTone="ink"
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
        </>
        )}
      </section>
    </div>
  );
}
