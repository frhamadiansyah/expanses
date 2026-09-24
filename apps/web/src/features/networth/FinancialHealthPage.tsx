import { isoDate, lastNMonths, monthOf } from '@expanses/core';
import { useState } from 'react';
import { ErrorBox } from '../../ui';
import { PushedTitle, SCREEN } from '../../ui/native';
import { HealthRatios } from './HealthRatios';
import { periodRange, type RatioPeriod, ratioTotals } from './health-cards';
import { useNetWorthSeries, usePeriodFlows, useSheet } from './queries';

/**
 * The ratios on a screen of their own, one tap from Net worth's top corner.
 *
 * They were the last section of the Net worth page, under a balance sheet and a chart nobody scrolled past to reach
 * them — a question about how you are doing, sitting under the answer to what you have. iOS keeps a screen like this
 * in the corner rather than at the foot of another screen, and the period they are read over belongs to this screen:
 * `useNetWorthSeries` is the same query the page behind it makes, so the earliest year the switch offers costs no
 * second read.
 */
export function FinancialHealthPage() {
  const today = isoDate();
  const months = lastNMonths(monthOf(today), 12);
  const series = useNetWorthSeries(months);
  const [period, setPeriod] = useState<RatioPeriod>({ key: 'ttm' });
  const range = periodRange(period, today);
  const flows = usePeriodFlows({ from: range.from, to: range.to });
  const periodSheetInputs = useSheet(range.balanceDate);

  const periodTotals = ratioTotals(periodSheetInputs.data);
  const monthsWithData = flows.data?.months ?? 0;
  const monthsNote =
    monthsWithData === 0
      ? 'No transactions in this period yet, so the ratios that need cash flow stay empty.'
      : `${range.label}: ${monthsWithData === 1 ? '1 month' : `${monthsWithData} months`} of transactions, with balances as of ${range.balanceDate}.`;
  const points = series.data ?? [];

  return (
    <div className={SCREEN}>
      <PushedTitle title="Financial health" back="Net worth" backTo="/net-worth" />
      <ErrorBox error={flows.error ?? periodSheetInputs.error ?? series.error} />
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
