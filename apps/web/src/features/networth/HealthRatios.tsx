import { DEFAULT_EMERGENCY_BASE, healthRatios, householdEmergencyMonths, type PeriodFlows, type RatioStatus, type SheetTotals } from '@expanses/core';
import { usePhone } from '../../app/use-phone';
import { Panel, type Segment, SegmentedControl } from '../../ui/native';
import { useGoalCalculators, useGoals } from '../goals/queries';
import { EMPTY_FLOWS, emergencyGoalBase, periodChoices, periodRange, type RatioPeriod, ratioDisplay, withEmergencyLoading, withJointRatios } from './health-cards';
import { useHealthSettings } from './health-settings';
import { useEssentialSplit, useSpendingGuide } from '../essential-split/queries';
import { SplitBar } from '../essential-split/SplitBar';
import { splitCard } from '../essential-split/split-view';

/** The status, in the kit's own inks rather than in four tinted pills. */
const STATUS_INK: Record<RatioStatus, string> = {
  good: 'text-[var(--ph-up)]',
  watch: 'text-[var(--ph-warn)]',
  act: 'text-[var(--ph-alarm)]',
  unknown: 'text-[var(--ph-ink-3)]',
};
const STATUS_BAR: Record<RatioStatus, string> = {
  good: 'bg-[var(--ph-up)]',
  watch: 'bg-[var(--ph-warn)]',
  act: 'bg-[var(--ph-alarm)]',
  unknown: 'bg-[var(--ph-chevron)]',
};

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
  jointTotals,
  jointMissing = [],
}: {
  flows: PeriodFlows | undefined;
  /** Null while a currency on the balance date has no rate; `missing` names it. */
  totals: SheetTotals | null;
  missing: readonly string[];
  period: RatioPeriod;
  onPeriod: (period: RatioPeriod) => void;
  today: string;
  earliestYear: number;
  /**
   * The household's totals when the group files jointly (§8.2): its balance-sheet ratios are read from them, the rest
   * stay this phone's own. Undefined when not filing jointly; null while they cannot be told (those ratios blank).
   */
  jointTotals?: SheetTotals | null;
  /** Currencies the household's sheet has no rate for, named under the ratios they blank. */
  jointMissing?: readonly string[];
}) {
  // What the emergency fund counts and the debt guide, as set on this screen's Settings page (the ⚙ in the corner).
  // The base stays unset until it is switched: until then it is the emergency goal's own.
  const settings = useHealthSettings();
  const phone = usePhone();
  // Q5: the card grades against the household's own months, read from its emergency goal — never a copy of them.
  // Called whether or not the totals are there: hooks run on every render.
  const goals = useGoals();
  const calculators = useGoalCalculators();
  const emergencyTargetMonths = householdEmergencyMonths(goals.data ?? []) ?? undefined;
  // It opens on the base that goal counts, so the card and the goal it grades against measure the same months.
  const emergencyBase = settings.emergencyBase ?? emergencyGoalBase(goals.data ?? [], calculators.data ?? []) ?? DEFAULT_EMERGENCY_BASE;
  // No ratios at all without every rate: a ratio worked out from a total that left some money at 0 is wrong, not partial.
  const ratioSettings = { ...settings, emergencyBase, emergencyTargetMonths };
  const ratios =
    totals === null
      ? []
      : withEmergencyLoading(
          withJointRatios(
            healthRatios(flows ?? EMPTY_FLOWS, totals, ratioSettings),
            jointTotals === undefined ? undefined : jointTotals === null ? null : healthRatios(flows ?? EMPTY_FLOWS, jointTotals, ratioSettings),
          ),
          goals.isPending || calculators.isPending,
        );
  const choices = periodChoices(today, earliestYear);
  // Essential · Lifestyle · Debts & savings over the same period, owner-wide as the flows are, graded by the workspace's guide.
  const range = periodRange(period, today);
  const split = useEssentialSplit({ from: range.from, to: range.to }, { owner: true });
  const card = splitCard(split.data?.split, useSpendingGuide());

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
       * the name in the bar is the screen introducing itself twice. Nor a line under the switch counting the months
       * of transactions: the tiles say "Not enough data" themselves when there are none. */}
      <SegmentedControl
        className="mb-[18px] md:max-w-2xl"
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

      {totals === null && (
        <Panel wide className="mb-[18px]">
          <p data-testid="ratios-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">
            No {missing.join(', ')} rate yet, so the ratios cannot be worked out.
          </p>
        </Panel>
      )}

      {totals !== null && jointMissing.length > 0 && (
        <Panel wide className="mb-[18px]">
          <p data-testid="joint-ratios-missing" className="text-[15px] leading-[20px] text-[var(--ph-warn)]">
            No {jointMissing.join(', ')} rate yet, so the household's balance-sheet ratios cannot be worked out.
          </p>
        </Panel>
      )}

      {/*
       * Eleven tiles, still a grid on a desktop: four across, two on a tablet, one on a phone. Each is the name, the
       * figure and its grade, the guide's figure, the gauge and one line on how it is worked out. What the emergency
       * fund counts and the debt guide are on the Settings page behind the ⚙, beside the choices that change them.
       */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ratios.flatMap((ratio) => {
          const display = ratioDisplay(ratio);
          const tile = (
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
          if (ratio.key !== 'savings_ratio') return [tile];
          // One card after the savings ratio, in the same parts: its name and grade, the three shares, the guide, the bar.
          return [
            tile,
            <Panel key="essential_split" wide className="space-y-1.5" testId="split-card">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] leading-[17px] font-semibold text-[var(--ph-ink)]">{card.name}</h3>
                <span className={`text-[11.5px] font-semibold tracking-[0.06em] whitespace-nowrap uppercase ${STATUS_INK[card.status]}`} data-testid="split-card-status">
                  {card.statusLabel}
                </span>
              </div>
              <div className="tabular text-[22px] leading-[26px] font-extrabold tracking-[-0.03em] text-[var(--ph-ink)]" data-testid="split-card-value">
                {card.value}
              </div>
              <div className="text-[12.5px] leading-[16px] text-[var(--ph-ink-2)]" data-testid="split-card-guide">
                Guide: {card.benchmark}
              </div>
              {card.bar ? <SplitBar parts={card.bar} marks={card.marks} height={6} /> : <div className="h-1.5 rounded-full bg-[var(--ph-track)]" />}
              <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{card.explanation}</p>
            </Panel>,
          ];
        })}
      </div>
    </section>
  );
}
