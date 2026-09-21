import { type CycleBonus, formatMinor } from '@expanses/core';
import { cx } from '../../ui';
import { InsetGroup } from '../../ui/native';
import { activeDuring, bonusStanding } from './catalog-panel';
import { FigureRow, Meter, SUBTITLE } from './rows';
import { type CycleResult, formatPoints } from './useCardPoints';

/** Spend toward each cycle bonus in force at the cycle's end, and what the next tier needs: one row each. */
export function BonusProgress({ bonuses, result, unit, currency }: { bonuses: CycleBonus[]; result: CycleResult; unit: string; currency: string }) {
  const active = bonuses.filter((bonus) => activeDuring(bonus, result.cycle.end, result.cycle.end));
  if (active.length === 0) return null;
  return (
    <InsetGroup header="Bonus progress">
      {active.map((bonus) => {
        const standing = bonusStanding(bonus, result.earn.eligibleSpendByBonus[bonus.id] ?? 0, result.earn.bonusById[bonus.id] ?? 0);
        return (
          <FigureRow key={bonus.id} title={bonus.name} value={`${formatMinor(standing.eligibleSpendMinor, currency)} → ${formatPoints(standing.awarded)} ${unit}`}>
            {/* The fraction is the standing's own, which already knows the top tier: the kit's bar recomputes it. */}
            <Meter fraction={standing.fraction} label={`${bonus.name} progress`} />
            <p className={cx('mt-[4px]', SUBTITLE)}>
              {standing.next ? `${formatMinor(standing.remainingMinor, currency)} more for ${formatPoints(standing.next.bonus)} ${unit}` : 'Top tier reached this cycle'}
            </p>
          </FigureRow>
        );
      })}
    </InsetGroup>
  );
}
