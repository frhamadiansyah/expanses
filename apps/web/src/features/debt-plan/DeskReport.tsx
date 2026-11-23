import { formatMinor } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { BarChart3, CalendarRange, HandCoins, Landmark, Percent, Wallet } from 'lucide-react';
import { cx, ErrorBox } from '../../ui';
import { Card, Seg, type Tone, Tag, TileRow } from '../../ui/desk';
import { monthYearLabel } from '../loans/loan-view';
import { MoneyTile, TD, TH, TR } from './DesktopDebtPlan';
import { useReport } from './ReportPanel';
import { type MonthBar, monthTag, PERIODS, type ReportPeriod } from './report-view';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Paid against due by month (today's Report chart): grey due, green paid, side by side from one baseline. */
export function DeskDueBars({ bars, currency, height = 110, testId }: { bars: readonly MonthBar[]; currency: string; height?: number; testId?: string }) {
  const top = Math.max(1, ...bars.flatMap((b) => [b.dueMinor, b.paidMinor]));
  const bar = (minor: number) => (minor > 0 ? Math.max(2, Math.round((minor / top) * height)) : 0);
  return (
    <div className="px-[20px] pb-[16px]" data-testid={testId}>
      <div className="flex items-end gap-[10px] border-b border-[var(--mk-line)]" style={{ height }} role="img" aria-label="Paid against due by month">
        {bars.map((b) => (
          <div
            key={b.month}
            data-testid="due-bar"
            data-month={b.month}
            className="flex min-w-0 flex-1 items-end justify-center gap-[3px]"
            title={`${SHORT[Number(b.month.slice(5, 7)) - 1]}: due ${formatMinor(b.dueMinor, currency)}, paid ${formatMinor(b.paidMinor, currency)}`}
          >
            <span className="block w-full max-w-[22px] rounded-t-[4px] bg-[var(--mk-track)]" style={{ height: bar(b.dueMinor) }} />
            <span className="block w-full max-w-[22px] rounded-t-[4px] bg-[var(--ph-up)]" style={{ height: bar(b.paidMinor) }} />
          </div>
        ))}
      </div>
      <div className="flex gap-[10px] pt-[5px]">
        {bars.map((b) => (
          <span key={b.month} className="min-w-0 flex-1 truncate text-center text-[11px] text-[var(--mk-ink-2)]">
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
  const tone: Tone = bar.late > 0 ? 'red' : bar.allPaid ? 'green' : 'grey';
  return <Tag tone={tone}>{tag}</Tag>;
}

/**
 * The Report on a wide screen: today's Report (`useReport`, the phone's own readings) — a period, Borrowed / Repaid /
 * Left / Interest paid as v1's tiles, paid against due by month, and the months in a table with their tags. No new
 * figures.
 */
export function DeskReport({ period }: { period: ReportPeriod }) {
  const navigate = useNavigate();
  const { figures, bars, error, currency } = useReport(period);
  const value = (minor: number | null | undefined) => (minor === undefined ? '' : minor === null ? '—' : formatMinor(minor, currency));
  const missing = figures && figures.missing.length > 0 ? `No ${figures.missing.join(', ')} rate yet` : null;
  return (
    <div className="@container px-[32px] pt-[2px] pb-[32px]" data-testid="report-panel">
      <div className="mb-[16px] flex items-center gap-[12px]">
        <Seg label="Period" value={period} onChange={(next) => void navigate({ to: '/net-worth/plan/report', search: { period: next }, replace: true })} options={PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
        {missing && <span className="text-[12.5px] text-[var(--mk-t-orange)]">{missing}, so those are left out</span>}
      </div>
      <ErrorBox error={error} />
      <TileRow>
        <MoneyTile icon={HandCoins} colour="indigo" value={value(figures?.borrowedMinor)} valueTestId="report-borrowed" label="Borrowed" />
        <MoneyTile icon={Wallet} colour="green" value={value(figures?.repaidMinor)} valueTestId="report-repaid" tone="text-[var(--ph-up)]" label="Repaid" />
        <MoneyTile icon={Landmark} colour="blue" value={value(figures?.leftMinor)} valueTestId="report-left" label="Left" />
        <MoneyTile icon={Percent} colour="orange" value={value(figures?.interestMinor)} valueTestId="report-interest" label="Interest paid" />
      </TileRow>
      {bars && bars.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-[16px] @min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Paid against due" icon={BarChart3} note="grey due · green paid" testId="report-bars">
            <DeskDueBars bars={bars} currency={currency} height={140} />
          </Card>
          <Card title="By month" icon={CalendarRange} note="debts only, no bills" className="overflow-clip" bodyClassName="px-[10px] pb-[8px]">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr>
                  <th className={TH}>Month</th>
                  <th className={cx(TH, 'text-right')}>Due</th>
                  <th className={cx(TH, 'text-right')}>Paid</th>
                  <th className={TH}>
                    <span className="sr-only">State</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bars.map((bar) => (
                  <tr key={bar.month} data-testid="report-month" className={cx(TR, 'text-[var(--mk-ink)]')}>
                    <td className={cx(TD, 'whitespace-nowrap')}>{monthYearLabel(bar.month)}</td>
                    <td className={cx(TD, 'text-right whitespace-nowrap tabular-nums')}>{formatMinor(bar.dueMinor, currency)}</td>
                    <td className={cx(TD, 'text-right whitespace-nowrap tabular-nums')}>
                      {bar.soFar && <span className="mr-[4px] text-[12px] text-[var(--mk-ink-2)]">so far</span>}
                      {formatMinor(bar.paidMinor, currency)}
                    </td>
                    <td className={cx(TD, 'text-right')}>
                      <MonthPill bar={bar} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
