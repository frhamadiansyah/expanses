import { DEFAULT_EMERGENCY_BASE, type HealthRatio, healthRatios, householdEmergencyMonths, isoDate, lastNMonths, monthOf, type PeriodFlows, type SheetTotals } from '@expanses/core';
import { useGoalCalculators, useGoals } from '../goals/queries';
import { useMonthStart } from '../workspaces/queries';
import { EMPTY_FLOWS, emergencyGoalBase, periodRange, type RatioPeriod, ratioInputs, ratioTotals, withEmergencyLoading, withJointRatios } from './health-cards';
import { useHealthSettings } from './health-settings';
import { useJointSheet, useNetWorthSeries, usePeriodFlows, useSheet } from './queries';

/**
 * What the ratios are read from over a period: the period's flows, the balance-sheet totals on its balance date (or the
 * currencies with no rate), and — with one tax ID — the household's totals (§8.2). Financial health's screen and the Mac
 * Net worth page's health box read the same, so the two never grade differently.
 */
export function useHealthInputs(period: RatioPeriod) {
  const today = isoDate();
  const months = lastNMonths(monthOf(today), 12);
  const series = useNetWorthSeries(months);
  // The workspace's months ("Month starts on"), as Cashflow and Budget count them.
  const monthStart = useMonthStart();
  const range = periodRange(period, today, monthStart);
  const flows = usePeriodFlows({ from: range.from, to: range.to }, monthStart);
  const periodSheetInputs = useSheet(range.balanceDate);
  // With one tax ID the ratios read the household's balance sheet on the same date (§8.2).
  const joint = useJointSheet(range.balanceDate);

  const periodTotals = ratioTotals(periodSheetInputs.data);
  /*
   * With one tax ID the balance-sheet ratios are the household's (controller ruling, review round 1): undefined when
   * not filing jointly; null while the household's sheet cannot be told (loading, an error, a rate or a month missing),
   * so those ratios are blank rather than personal figures under the household's name.
   */
  let jointTotals: SheetTotals | null | undefined;
  let jointMissing: string[] = [];
  if (joint.status !== 'personal') {
    const household = joint.status === 'joint' && joint.data ? ratioTotals(ratioInputs(periodSheetInputs.data, joint.data)) : null;
    jointMissing = household?.missing ?? [];
    jointTotals = household && joint.data?.totalMinor !== null ? household.totals : null;
  }
  const points = series.data ?? [];
  return {
    today,
    flows: flows.data,
    totals: periodTotals.totals,
    missing: periodTotals.missing,
    jointTotals,
    jointMissing,
    earliestYear: Number((points[0]?.month ?? today).slice(0, 4)),
    error: flows.error ?? periodSheetInputs.error ?? series.error ?? joint.error,
  };
}

/**
 * The ratios as the health screen grades them: this device's settings (what the emergency fund counts, the debt guide),
 * the emergency goal's own months, the household's balance-sheet ratios where it files jointly. Empty while a rate is
 * missing (`totals` null): a ratio from a total that left some money at 0 is wrong, not partial.
 */
export function useHealthRatios({ flows, totals, jointTotals }: { flows: PeriodFlows | undefined; totals: SheetTotals | null; jointTotals?: SheetTotals | null }): HealthRatio[] {
  // What the emergency fund counts and the debt guide, as set on the health screen's Settings page.
  // The base stays unset until it is switched: until then it is the emergency goal's own.
  const settings = useHealthSettings();
  // Q5: the card grades against the household's own months, read from its emergency goal — never a copy of them.
  // Called whether or not the totals are there: hooks run on every render.
  const goals = useGoals();
  const calculators = useGoalCalculators();
  const emergencyTargetMonths = householdEmergencyMonths(goals.data ?? []) ?? undefined;
  // It opens on the base that goal counts, so the card and the goal it grades against measure the same months.
  const emergencyBase = settings.emergencyBase ?? emergencyGoalBase(goals.data ?? [], calculators.data ?? []) ?? DEFAULT_EMERGENCY_BASE;
  const ratioSettings = { ...settings, emergencyBase, emergencyTargetMonths };
  if (totals === null) return [];
  return withEmergencyLoading(
    withJointRatios(
      healthRatios(flows ?? EMPTY_FLOWS, totals, ratioSettings),
      jointTotals === undefined ? undefined : jointTotals === null ? null : healthRatios(flows ?? EMPTY_FLOWS, jointTotals, ratioSettings),
    ),
    goals.isPending || calculators.isPending,
  );
}
