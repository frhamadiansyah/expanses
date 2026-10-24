import { DEFAULT_DEBT_SERVICE_BPS, DEFAULT_EMERGENCY_BASE, type EmergencyBase, healthRatios, householdEmergencyMonths } from '@expanses/core';
import { useBack } from '../../app/BackHeader';
import { InsetGroup, PushedTitle, ReadOnlyRow, SCREEN, type Segment, SegmentedControl, SelectRow } from '../../ui/native';
import { useGoalCalculators, useGoals } from '../goals/queries';
import { EMPTY_FLOWS, EMPTY_TOTALS, emergencyGoalBase } from './health-cards';
import { changeHealthSettings, useHealthSettings } from './health-settings';

/** What the emergency fund's months multiply — the spec's segmented switch, essential by default. */
const EMERGENCY_BASE_SEGMENTS: Segment[] = [
  { key: 'essential', label: 'Essential spending', short: 'Essential' },
  { key: 'all', label: 'All spending', short: 'All' },
];

/**
 * Financial health's settings on a page of their own, behind the ⚙ in its corner: what the emergency fund counts,
 * which debt-servicing guide grades the payments, and how each ratio is worked out. They sat under the tiles, an
 * explanation on every visit to a screen read for its figures; set once or twice and read when a figure surprises,
 * they wait here, as a holding's details wait behind its own ⚙.
 *
 * Every row saves as it is changed, as iOS's own settings do; the page has no Save.
 */
export function HealthSettingsPage() {
  const settings = useHealthSettings();
  // As the ratios read them (Q5): the card grades against the household's own months, from its emergency goal, and
  // until the base is switched it counts what that goal counts.
  const goals = useGoals();
  const calculators = useGoalCalculators();
  const emergencyBase = settings.emergencyBase ?? emergencyGoalBase(goals.data ?? [], calculators.data ?? []) ?? DEFAULT_EMERGENCY_BASE;
  const emergencyTargetMonths = householdEmergencyMonths(goals.data ?? []) ?? undefined;
  // The ratios read over nothing, for their names, guides and methods alone: the words are the same whatever the
  // figures, and the ones that change with a setting here change with it.
  const methods = healthRatios(EMPTY_FLOWS, EMPTY_TOTALS, { ...settings, emergencyBase, emergencyTargetMonths });
  const goBack = useBack('/net-worth/health');
  return (
    <div className={SCREEN}>
      <PushedTitle title="Settings" back="Financial health" onBack={goBack} />

      <InsetGroup
        header="Emergency fund counts"
        footer="Cash & equivalents on the balance sheet, against a month of spending plus loan principal — what keeps arriving when income stops. Essential spending leaves the categories marked lifestyle out. Loan interest is already inside spending, so it is not added again. Until it is switched, the base is the emergency goal's own."
      >
        <div className="px-3 py-2.5">
          <SegmentedControl
            label="Emergency fund counts"
            segments={EMERGENCY_BASE_SEGMENTS}
            value={emergencyBase}
            onChange={(key) => changeHealthSettings({ emergencyBase: key as EmergencyBase })}
          />
        </div>
      </InsetGroup>

      <InsetGroup
        header="How the ratios are worked out"
        footer="Take-home pay is what actually landed in these accounts, so tax and contributions withheld at source are already out. Employer pension contributions are not counted yet. Balances are read on the period's last day: today for the last 12 months, 31 December for a year."
      >
        <SelectRow
          label="Debt servicing guide"
          value={settings.debtServiceBenchmarkBps ?? DEFAULT_DEBT_SERVICE_BPS}
          onChange={(e) => changeHealthSettings({ debtServiceBenchmarkBps: Number(e.target.value) })}
        >
          <option value={3000}>30% · the planning guide</option>
          <option value={3500}>35% · a looser guide</option>
        </SelectRow>
        {/* One row a ratio: its guide as the figure, and its working behind the ⓘ. */}
        {methods.map((ratio) => (
          <ReadOnlyRow key={ratio.key} label={ratio.name} value={ratio.benchmarkText} info={ratio.companion ? `${ratio.guide} A companion to the savings ratio rather than a guide ratio.` : ratio.guide} />
        ))}
      </InsetGroup>
    </div>
  );
}
