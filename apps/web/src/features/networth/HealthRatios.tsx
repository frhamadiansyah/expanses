import {
  DEFAULT_DEBT_SERVICE_BPS,
  DEFAULT_EMERGENCY_BASE,
  type EmergencyBase,
  healthRatios,
  householdEmergencyMonths,
  type PeriodFlows,
  type RatioSettings,
  type RatioStatus,
  type SheetTotals,
} from '@expanses/core';
import { useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { InsetGroup, Panel, PanelHeader, type Segment, SegmentedControl, SelectRow } from '../../ui/native';
import { useGoalCalculators, useGoals } from '../goals/queries';
import { emergencyGoalBase, periodChoices, periodRange, type RatioPeriod, ratioDisplay, withEmergencyLoading } from './health-cards';

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

const EMPTY_FLOWS: PeriodFlows = { months: 0, incomeMinor: 0, spendingMinor: 0, lifestyleSpendingMinor: 0, debtPaymentsMinor: 0, nonMortgageDebtPaymentsMinor: 0, debtPrincipalMinor: 0, putAwayMinor: 0 };

/** What the emergency fund's months multiply — the spec's segmented switch, essential by default. */
const EMERGENCY_BASE_SEGMENTS: Segment[] = [
  { key: 'essential', label: 'Essential spending', short: 'Essential' },
  { key: 'all', label: 'All spending', short: 'All' },
];

/** How wide the period track is on a desktop, where every year worth offering can be shown at once. */
const DESKTOP_TRACK = 640;

export function HealthRatios({
  flows,
  totals,
  missing,
  period,
  onPeriod,
  today,
  earliestYear,
  monthsNote,
}: {
  flows: PeriodFlows | undefined;
  /** Null while a currency on the balance date has no rate; `missing` names it. */
  totals: SheetTotals | null;
  missing: readonly string[];
  period: RatioPeriod;
  onPeriod: (period: RatioPeriod) => void;
  today: string;
  earliestYear: number;
  monthsNote: string;
}) {
  // The base stays unset until it is switched: until then it is the emergency goal's own.
  const [settings, setSettings] = useState<RatioSettings>({ debtServiceBenchmarkBps: DEFAULT_DEBT_SERVICE_BPS });
  const phone = usePhone();
  // Q5: the card grades against the household's own months, read from its emergency goal — never a copy of them.
  // Called whether or not the totals are there: hooks run on every render.
  const goals = useGoals();
  const calculators = useGoalCalculators();
  const emergencyTargetMonths = householdEmergencyMonths(goals.data ?? []) ?? undefined;
  // It opens on the base that goal counts, so the card and the goal it grades against measure the same months.
  const emergencyBase = settings.emergencyBase ?? emergencyGoalBase(goals.data ?? [], calculators.data ?? []) ?? DEFAULT_EMERGENCY_BASE;
  // No ratios at all without every rate: a ratio worked out from a total that left some money at 0 is wrong, not partial.
  const ratios =
    totals === null
      ? []
      : withEmergencyLoading(
          healthRatios(flows ?? EMPTY_FLOWS, totals, { ...settings, emergencyBase, emergencyTargetMonths }),
          goals.isPending || calculators.isPending,
        );
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
      {/* No heading of its own: the screen this is on is called Financial health already, and a section repeating
       * the name in the bar is the screen introducing itself twice. */}
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

      {totals === null && (
        <Panel wide className="mb-[18px]">
          <p data-testid="ratios-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">
            No {missing.join(', ')} rate yet, so the ratios cannot be worked out.
          </p>
        </Panel>
      )}

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

      <p className="px-[4px] pb-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Emergency fund counts</p>
      <SegmentedControl
        className="mb-[18px] md:max-w-2xl"
        label="Emergency fund counts"
        segments={EMERGENCY_BASE_SEGMENTS}
        value={emergencyBase}
        onChange={(key) => setSettings((current) => ({ ...current, emergencyBase: key as EmergencyBase }))}
      />
      <InsetGroup
        header="How the ratios are worked out"
        footer="Take-home pay is what actually landed in your accounts, so tax and contributions withheld at source are already out. Employer pension contributions are not counted yet. Loan principal counts toward the emergency fund either way; the interest is already spending."
      >
        <SelectRow
          label="Debt servicing guide"
          value={settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS}
          onChange={(e) => setSettings((current) => ({ ...current, debtServiceBenchmarkBps: Number(e.target.value) }))}
        >
          <option value={3000}>30% · the planning guide</option>
          <option value={3500}>35% · a looser guide</option>
        </SelectRow>
      </InsetGroup>
    </section>
  );
}
