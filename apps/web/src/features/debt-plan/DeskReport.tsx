import { formatMinor } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { cx, ErrorBox } from '../../ui';
import { BOX, BoxHead } from '../transactions/CashflowBoxes';
import { monthYearLabel } from '../loans/loan-view';
import { Segments, TD, TH } from './DesktopDebtPlan';
import { useReport } from './ReportPanel';
import { type MonthBar, monthTag, PERIODS, type ReportPeriod } from './report-view';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Paid against due by month (today's Report chart): grey due, green paid, side by side from one baseline. */
export function DeskDueBars({ bars, currency, height = 110, testId }: { bars: readonly MonthBar[]; currency: string; height?: number; testId?: string }) {
  const top = Math.max(1, ...bars.flatMap((b) => [b.dueMinor, b.paidMinor]));
  const bar = (minor: number) => (minor > 0 ? Math.max(2, Math.round((minor / top) * height)) : 0);
  return (
    <div className="px-[14px] pb-[10px]" data-testid={testId}>
      <div className="flex items-end gap-[10px] border-b border-[var(--ph-hair)]" style={{ height }} role="img" aria-label="Paid against due by month">
        {bars.map((b) => (
          <div
            key={b.month}
            data-testid="due-bar"
            data-month={b.month}
            className="flex min-w-0 flex-1 items-end justify-center gap-[3px]"
            title={`${SHORT[Number(b.month.slice(5, 7)) - 1]}: due ${formatMinor(b.dueMinor, currency)}, paid ${formatMinor(b.paidMinor, currency)}`}
          >
            <span className="block w-full max-w-[22px] rounded-t-[3px] bg-[var(--ph-track)]" style={{ height: bar(b.dueMinor) }} />
            <span className="block w-full max-w-[22px] rounded-t-[3px] bg-[var(--ph-up)]" style={{ height: bar(b.paidMinor) }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[10px] pt-[4px]">
        {bars.map((b) => (
          <span key={b.month} className="min-w-0 flex-1 truncate text-center text-[10.5px] text-[var(--ph-ink-3)]">
            {SHORT[Number(b.month.slice(5, 7)) - 1]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A month's tag in the Report's table: "2 late" red, "All paid" green, "Nothing due" grey. */
export function MonthPill({ bar }: { bar: MonthBar }) {
  const tag = monthTag(bar);
  if (!tag) return null;
  const look = bar.late > 0 ? 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm)]' : bar.allPaid ? 'bg-[var(--ph-up-panel)] text-[var(--ph-up-ink)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-3)]';
  return <span className={cx('rounded-[4px] px-[5px] text-[11px] font-semibold whitespace-nowrap', look)}>{tag}</span>;
}

/**
 * The Report on a wide screen: today's Report (`useReport`, the phone's own readings) — a period, Borrowed / Repaid /
 * Left / Interest paid, paid against due by month, and the months in a table with their late pills. No new figures.
 */
export function DeskReport({ period }: { period: ReportPeriod }) {
  const navigate = useNavigate();
  const { figures, bars, error, currency } = useReport(period);
  const figure = (label: string, minor: number | null | undefined, testId: string, tone = 'text-[var(--ph-ink)]') => (
    <section className={BOX} aria-label={label}>
      <BoxHead title={label} />
      <div data-testid={testId} className={cx('px-[14px] pb-[12px] text-[19px] leading-[24px] font-semibold whitespace-nowrap tabular-nums', tone)}>
        {minor === undefined ? '' : minor === null ? <span className="text-[13px] text-[var(--ph-warn)]">No {figures?.missing.join(', ')} rate yet</span> : formatMinor(minor, currency)}
      </div>
    </section>
  );
  return (
    <div className="@container space-y-[14px] px-[20px] py-[16px]" data-testid="report-panel">
      <div className="max-w-[420px]">
        <Segments fill label="Period" value={period} onChange={(next) => void navigate({ to: '/net-worth/plan/report', search: { period: next }, replace: true })} options={PERIODS} />
      </div>
      <ErrorBox error={error} />
      <div className="grid grid-cols-2 gap-[14px] @min-[760px]:grid-cols-4">
        {figure('Borrowed', figures?.borrowedMinor, 'report-borrowed')}
        {figure('Repaid', figures?.repaidMinor, 'report-repaid', 'text-[var(--ph-up)]')}
        {figure('Left', figures?.leftMinor, 'report-left')}
        {figure('Interest paid', figures?.interestMinor, 'report-interest')}
      </div>
      {figures && figures.missing.length > 0 && <p className="text-[12px] text-[var(--ph-warn)]">{`No ${figures.missing.join(', ')} rate yet, so those are left out`}</p>}
      {bars && bars.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-[14px] @min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className={BOX} aria-label="Paid against due" data-testid="report-bars">
            <BoxHead title="Paid against due" note="grey due · green paid" />
            <DeskDueBars bars={bars} currency={currency} height={140} />
          </section>
          <section className={cx(BOX, 'overflow-clip')} aria-label="By month">
            <BoxHead title="By month" note="debts only, no bills" />
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={cx(TH, 'pl-[14px]')}>Month</th>
                  <th className={cx(TH, 'text-right')}>Due</th>
                  <th className={cx(TH, 'text-right')}>Paid</th>
                  <th className={cx(TH, 'pr-[14px]')}>
                    <span className="sr-only">State</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bars.map((bar, index) => (
                  <tr key={bar.month} data-testid="report-month" className={index % 2 === 1 ? 'bg-[var(--mac-zebra)]' : undefined}>
                    <td className={cx(TD, 'pl-[14px] whitespace-nowrap')}>{monthYearLabel(bar.month)}</td>
                    <td className={cx(TD, 'text-right whitespace-nowrap tabular-nums')}>{formatMinor(bar.dueMinor, currency)}</td>
                    <td className={cx(TD, 'text-right whitespace-nowrap tabular-nums')}>
                      {bar.soFar && <span className="mr-[4px] text-[11.5px] text-[var(--ph-ink-3)]">so far</span>}
                      {formatMinor(bar.paidMinor, currency)}
                    </td>
                    <td className={cx(TD, 'pr-[14px]')}>
                      <MonthPill bar={bar} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
