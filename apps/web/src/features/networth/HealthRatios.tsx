import { DEFAULT_DEBT_SERVICE_BPS, healthRatios, type PeriodFlows, type RatioSettings, type RatioStatus, type SheetTotals } from '@expanses/core';
import { useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { InsetGroup, Panel, PanelHeader, type Segment, SegmentedControl, SelectRow } from '../../ui/native';
import { SwitchRow } from './SwitchRow';
import { periodChoices, periodRange, type RatioPeriod, ratioDisplay } from './health-cards';

/** The status, in the kit's own inks rather than in four tinted pills. */
const STATUS_INK: Record<RatioStatus, string> = {
  good: 'text-[var(--ph-tint)]',
  watch: 'text-[var(--ph-warn)]',
  act: 'text-[var(--ph-alarm)]',
  unknown: 'text-[var(--ph-ink-3)]',
};
const STATUS_BAR: Record<RatioStatus, string> = {
  good: 'bg-[var(--ph-tint)]',
  watch: 'bg-[var(--ph-warn)]',
  act: 'bg-[var(--ph-alarm)]',
  unknown: 'bg-[var(--ph-chevron)]',
};

const EMPTY_FLOWS: PeriodFlows = { months: 0, incomeMinor: 0, spendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, debtPrincipalMinor: 0, putAwayMinor: 0 };

/** How wide the period track is on a desktop, where every year worth offering can be shown at once. */
const DESKTOP_TRACK = 640;

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
  const phone = usePhone();
  const ratios = healthRatios(flows ?? EMPTY_FLOWS, totals, settings);
  const choices = periodChoices(today, earliestYear);

  /*
   * The period switch was a row of little pressed buttons that grew a button a year. It is the kit's segmented
   * control now, so the years that do not fit go behind the `…` instead of wrapping onto a second line. The key
   * has to name the year as well as the kind: two "year" segments would otherwise be the same segment.
   */
  const keyOf = (choice: RatioPeriod) => (choice.key === 'year' ? `year-${choice.year}` : 'ttm');
  const segments: Segment[] = choices.map((choice) => ({ key: keyOf(choice), label: periodRange(choice, today).label, short: choice.key === 'ttm' ? '12 mo' : undefined }));

  return (
    <section className="mb-[18px]">
      <PanelHeader title="Financial health" />
      <SegmentedControl
        className="mb-[10px] md:max-w-2xl"
        label="Period"
        segments={segments}
        value={keyOf(period)}
        onChange={(key) => {
          const chosen = choices.find((choice) => keyOf(choice) === key);
          if (chosen) onPeriod(chosen);
        }}
        width={phone ? undefined : DESKTOP_TRACK}
        max={phone ? undefined : segments.length}
      />
      <p className="px-[4px] pb-[10px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{monthsNote}</p>

      {/* Eleven tiles, still a grid on a desktop: four across, two on a tablet, one on a phone. */}
      <div className="mb-[18px] grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ratios.map((ratio) => {
          const display = ratioDisplay(ratio);
          return (
            <Panel key={ratio.key} wide className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] leading-[17px] font-semibold text-[var(--ph-ink)]">{ratio.name}</h3>
                <span className={`text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase ${STATUS_INK[ratio.status]}`}>{display.statusLabel}</span>
              </div>
              <div className="tabular text-[22px] leading-[26px] font-extrabold tracking-[-0.03em] text-[var(--ph-ink)]">{display.value}</div>
              <div className="text-[12.5px] leading-[16px] text-[var(--ph-ink-2)]">
                Guide: {ratio.benchmarkText}
                {ratio.companion && ' · companion to the savings ratio'}
              </div>
              <div
                className="relative h-1.5 rounded-full bg-[var(--ph-track)]"
                title={`Guide: ${ratio.lowerBetter ? 'at most' : 'at least'} ${ratio.target}${ratio.unit === 'percent' ? '%' : ' months'}`}
              >
                <i className={`absolute top-0 bottom-0 left-0 rounded-full ${STATUS_BAR[ratio.status]}`} style={{ width: `${display.gaugePercent}%` }} />
                <b className="absolute -top-1 h-3.5 w-0.5 bg-[var(--ph-ink)] opacity-60" style={{ left: `calc(${display.targetPercent}% - 1px)` }} />
              </div>
              <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{ratio.guide}</p>
            </Panel>
          );
        })}
      </div>

      <InsetGroup
        header="How the ratios are worked out"
        footer="Take-home pay is what actually landed in your accounts, so tax and contributions withheld at source are already out. Employer pension contributions are not counted yet."
      >
        <SwitchRow
          label="Count loan principal in the emergency fund"
          checked={!!settings.emergencyIncludesDebtPayments}
          onChange={(checked) => setSettings((current) => ({ ...current, emergencyIncludesDebtPayments: checked }))}
        />
        <SelectRow
          label="Debt servicing guide"
          value={settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS}
          onChange={(e) => setSettings((current) => ({ ...current, debtServiceBenchmarkBps: Number(e.target.value) }))}
        >
          <option value={3500}>35% · the planning guide</option>
          <option value={3000}>30% · what Indonesian lenders quote</option>
        </SelectRow>
      </InsetGroup>
    </section>
  );
}
