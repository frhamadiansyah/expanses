import { DEFAULT_DEBT_SERVICE_BPS, healthRatios, type PeriodFlows, type RatioSettings, type RatioStatus, type SheetTotals } from '@expanses/core';
import { useState } from 'react';
import { Card } from '../../ui';
import { periodChoices, periodRange, type RatioPeriod, ratioDisplay } from './health-cards';

const STATUS_PILL: Record<RatioStatus, string> = {
  good: 'bg-emerald-100 text-emerald-800',
  watch: 'bg-amber-100 text-amber-800',
  act: 'bg-red-100 text-red-800',
  unknown: 'bg-slate-100 text-slate-600',
};
const STATUS_BAR: Record<RatioStatus, string> = {
  good: 'bg-emerald-600',
  watch: 'bg-amber-500',
  act: 'bg-red-600',
  unknown: 'bg-slate-300',
};

const EMPTY_FLOWS: PeriodFlows = { months: 0, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, putAwayMinor: 0 };

export function HealthRatios({
  flows,
  totals,
  period,
  onPeriod,
  today,
  earliestYear,
  monthsNote,
}: {
  flows: PeriodFlows | undefined;
  totals: SheetTotals;
  period: RatioPeriod;
  onPeriod: (period: RatioPeriod) => void;
  today: string;
  earliestYear: number;
  monthsNote: string;
}) {
  const [settings, setSettings] = useState<RatioSettings>({ emergencyIncludesDebtPayments: true, debtServiceBenchmarkBps: DEFAULT_DEBT_SERVICE_BPS });
  const ratios = healthRatios(flows ?? EMPTY_FLOWS, totals, settings);
  const choices = periodChoices(today, earliestYear);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Financial health</h2>
        <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
          {choices.map((choice) => {
            const label = periodRange(choice, today).label;
            const selected = choice.key === period.key && (choice.key !== 'year' || period.key !== 'year' || choice.year === period.year);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={selected}
                onClick={() => onPeriod(choice)}
                className={`rounded-md px-2.5 py-1 text-xs ${selected ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-600'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500">{monthsNote}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ratios.map((ratio) => {
          const display = ratioDisplay(ratio);
          return (
            <div key={ratio.key} className={`space-y-1.5 rounded-xl p-3 ring-1 ${ratio.companion ? 'bg-slate-50 ring-slate-100' : 'ring-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{ratio.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_PILL[ratio.status]}`}>{display.statusLabel}</span>
              </div>
              <div className="tabular text-xl font-semibold">{display.value}</div>
              <div className="text-xs text-slate-600">
                Guide: {ratio.benchmarkText}
                {ratio.companion && ' · companion to the savings ratio'}
              </div>
              <div className="relative h-1.5 rounded-full bg-slate-100" title={`Guide: ${ratio.lowerBetter ? 'at most' : 'at least'} ${ratio.target}${ratio.unit === 'percent' ? '%' : ' months'}`}>
                <i className={`absolute top-0 bottom-0 left-0 rounded-full ${STATUS_BAR[ratio.status]}`} style={{ width: `${display.gaugePercent}%` }} />
                <b className="absolute -top-1 h-3.5 w-0.5 bg-slate-900 opacity-60" style={{ left: `calc(${display.targetPercent}% - 1px)` }} />
              </div>
              <p className="text-xs text-slate-500">{ratio.guide}</p>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        Take-home pay is what actually landed in your accounts, so tax and contributions withheld at source are already out. Employer JHT and DPLK are not counted yet.
      </p>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!settings.emergencyIncludesDebtPayments}
            onChange={(e) => setSettings((current) => ({ ...current, emergencyIncludesDebtPayments: e.target.checked }))}
          />
          Count debt payments in the emergency fund
        </label>
        <label className="flex items-center gap-2">
          Debt servicing guide
          <select
            aria-label="Debt servicing guide"
            className="rounded-lg border border-slate-300 px-2 py-1"
            value={settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS}
            onChange={(e) => setSettings((current) => ({ ...current, debtServiceBenchmarkBps: Number(e.target.value) }))}
          >
            <option value={3500}>35% · the planning guide</option>
            <option value={3000}>30% · what Indonesian lenders quote</option>
          </select>
        </label>
      </div>
    </Card>
  );
}
