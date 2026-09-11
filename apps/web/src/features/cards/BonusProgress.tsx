import { type CycleBonus, formatMinor } from '@expanses/core';
import { activeDuring, bonusStanding } from './catalog-panel';
import { type CycleResult, formatPoints } from './useCardPoints';

/** Spend toward each cycle bonus in force at the cycle's end, and what the next tier needs. */
export function BonusProgress({ bonuses, result, unit, currency }: { bonuses: CycleBonus[]; result: CycleResult; unit: string; currency: string }) {
  const active = bonuses.filter((bonus) => activeDuring(bonus, result.cycle.end, result.cycle.end));
  if (active.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {active.map((bonus) => {
        const standing = bonusStanding(bonus, result.earn.eligibleSpendByBonus[bonus.id] ?? 0, result.earn.bonusById[bonus.id] ?? 0);
        return (
          <li key={bonus.id} className="text-sm">
            <div className="flex justify-between">
              <span>{bonus.name}</span>
              <span className="tabular">
                {formatMinor(standing.eligibleSpendMinor, currency)} → {formatPoints(standing.awarded)} {unit}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-slate-100" role="progressbar" aria-label={`${bonus.name} progress`} aria-valuenow={Math.round(standing.fraction * 100)}>
              <div className="h-1.5 rounded bg-emerald-600" style={{ width: `${Math.round(standing.fraction * 100)}%` }} />
            </div>
            <div className="text-xs text-slate-500">
              {standing.next
                ? `${formatMinor(standing.remainingMinor, currency)} more for ${formatPoints(standing.next.bonus)} ${unit}`
                : 'Top tier reached this cycle'}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
