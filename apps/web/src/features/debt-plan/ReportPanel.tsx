import { formatMinor, isoDate } from '@expanses/core';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, Panel } from '../../ui/native';
import { Hair } from './ByHandList';
import { longMonth } from './plan-view';
import { useDebtMovements, useDebtPlan, usePlanMonths } from './queries';
import { type MonthBar, monthBars, monthTag, PERIODS, periodMonths, type ReportPeriod, reportFigures } from './report-view';

/**
 * The Report (spec §4.4): Borrowed, Repaid, Left and Interest paid for a period, read from the debts' own movements,
 * then paid against due by month (debts only, no bills). Drawn by the Report page and by the plan's wide Report tab.
 */

function PeriodChips({ period, onPeriod }: { period: ReportPeriod; onPeriod: (period: ReportPeriod) => void }) {
  return (
    <div role="radiogroup" aria-label="Period" className="mb-[14px] flex flex-wrap gap-2">
      {PERIODS.map((p) => {
        const on = p.key === period;
        return (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={on}
            className={`ph-focus rounded-full px-[12px] py-[6px] text-[14px] font-medium ${on ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-surface)] text-[var(--ph-ink)]'}`}
            onClick={() => onPeriod(p.key)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Grouped bars per month: grey for due, green for paid, from a shared baseline; one axis, no gridlines. */
function Bars({ bars, currency }: { bars: readonly MonthBar[]; currency: string }) {
  const top = Math.max(1, ...bars.flatMap((b) => [b.dueMinor, b.paidMinor]));
  const height = 120;
  const bar = (minor: number) => (minor > 0 ? Math.max(2, Math.round((minor / top) * height)) : 0);
  return (
    <div>
      <div className="flex items-end gap-[6px]" style={{ height }} role="img" aria-label="Paid against due by month">
        {bars.map((b) => (
          <div key={b.month} className="flex min-w-0 flex-1 items-end justify-center gap-[2px]" title={`${SHORT[Number(b.month.slice(5, 7)) - 1]}: due ${formatMinor(b.dueMinor, currency)}, paid ${formatMinor(b.paidMinor, currency)}`}>
            <span className="block w-full max-w-[22px] rounded-t-[4px] bg-[var(--ph-track)]" style={{ height: bar(b.dueMinor) }} />
            <span className="block w-full max-w-[22px] rounded-t-[4px] bg-[var(--ph-up)]" style={{ height: bar(b.paidMinor) }} />
          </div>
        ))}
      </div>
      <div className="mt-[6px] flex gap-[6px] border-t border-[var(--ph-hair)] pt-[4px]">
        {bars.map((b) => (
          <span key={b.month} className="min-w-0 flex-1 truncate text-center text-[11px] text-[var(--ph-ink-3)]">
            {SHORT[Number(b.month.slice(5, 7)) - 1]}
          </span>
        ))}
      </div>
      <div className="mt-[8px] flex gap-4 text-[12.5px] text-[var(--ph-ink-2)]">
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="block h-[10px] w-[10px] rounded-[2px] bg-[var(--ph-track)]" />
          Due
        </span>
        <span className="flex items-center gap-[6px]">
          <span aria-hidden className="block h-[10px] w-[10px] rounded-[2px] bg-[var(--ph-up)]" />
          Paid
        </span>
      </div>
    </div>
  );
}

function MonthLine({ bar, currency, first }: { bar: MonthBar; currency: string; first: boolean }) {
  const tag = monthTag(bar);
  const look = bar.late > 0 ? 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm)]' : bar.allPaid ? 'bg-[var(--ph-up-panel)] text-[var(--ph-up-ink)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-3)]';
  return (
    <li data-testid="report-month" className="relative">
      {!first && <Hair />}
      <div className="flex items-center gap-3 px-[16px] py-[11px]">
        <span className="min-w-0 flex-1 truncate text-[16px] text-[var(--ph-ink)]">{longMonth(bar.month).replace(/ \d{4}$/, '')}</span>
        {tag && <span className={`shrink-0 rounded-[4px] px-[5px] text-[12.5px] font-semibold ${look}`}>{tag}</span>}
        <span className="tabular shrink-0 text-[15px] text-[var(--ph-ink)]">
          {bar.soFar && <span className="mr-[4px] text-[12.5px] text-[var(--ph-ink-3)]">so far</span>}
          {formatMinor(bar.paidMinor, currency)}
        </span>
      </div>
    </li>
  );
}

export function ReportPanel({ period, onPeriod }: { period: ReportPeriod; onPeriod: (period: ReportPeriod) => void }) {
  const { ws } = useApp();
  const today = isoDate();
  const { model, error } = useDebtPlan();
  const accounts = useAccounts();
  const liabilities = (accounts.data ?? []).filter((a) => a.kind === 'liability' && a.archivedAt === null);
  // Card spending is borrowing here, so cards' movements are read too — on this page only.
  const movements = useDebtMovements(liabilities.map((a) => a.id));
  const earliest = movements.data?.[0]?.occurredOn ?? null;
  const months = periodMonths(period, today, earliest);
  const barMonths = period === 'all' ? months.slice(-12) : months;
  const { byMonth, error: monthError } = usePlanMonths(barMonths);
  const currencyOf = Object.fromEntries(liabilities.map((a) => [a.id, a.currency ?? ws.baseCurrency]));
  const figures = model && movements.data ? reportFigures(movements.data, model.debts, months, ws.baseCurrency, model.ratesToBase, currencyOf) : null;
  const bars = byMonth ? monthBars(byMonth, barMonths, today) : null;
  const figure = (minor: number | null, testId: string, tone = '') => (
    <span data-testid={testId} className={tone}>
      {minor === null ? <span className="text-[var(--ph-warn)]">{`No ${figures?.missing.join(', ')} rate yet`}</span> : <Money minor={minor} currency={ws.baseCurrency} />}
    </span>
  );

  return (
    <div data-testid="report-panel">
      <PeriodChips period={period} onPeriod={onPeriod} />
      <ErrorBox error={error ?? movements.error ?? monthError} />
      {figures && (
        <InsetGroup>
          <InsetRow title="Borrowed" value={figure(figures.borrowedMinor, 'report-borrowed')} />
          <InsetRow title="Repaid" value={figure(figures.repaidMinor, 'report-repaid', 'text-[var(--ph-up)]')} />
          <InsetRow title="Left" value={figure(figures.leftMinor, 'report-left', 'font-bold text-[var(--ph-ink)]')} />
          <InsetRow title="Interest paid" value={figure(figures.interestMinor, 'report-interest')} />
        </InsetGroup>
      )}
      {bars && bars.length > 0 && (
        <Panel header="Paid against due" testId="report-bars">
          <Bars bars={bars} currency={ws.baseCurrency} />
        </Panel>
      )}
      {bars && bars.length > 0 && (
        <Panel pad={false}>
          <ul>
            {bars.map((bar, index) => (
              <MonthLine key={bar.month} bar={bar} currency={ws.baseCurrency} first={index === 0} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
