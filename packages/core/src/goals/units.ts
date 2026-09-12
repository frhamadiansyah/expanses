import type { TradeRecord } from '../assets/position';
import { divRound, formatUnits } from '../assets/units';

/** Units bought without naming a goal sit under this key. */
export const UNTAGGED = '';

export interface GoalUnits {
  /** Units held per goal id, with untagged units under `UNTAGGED`. */
  byGoal: Record<string, number>;
  unitsMicro: number;
}

export class GoalError extends Error {
  readonly code = 'OVERSELL_GOAL' as const;

  constructor(message: string) {
    super(message);
    this.name = 'GoalError';
  }
}

const byTradeOrder = (a: TradeRecord, b: TradeRecord) =>
  a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Shares units out in proportion after a split or bonus units, the difference going to the largest goal. */
function scaleGoals(byGoal: Record<string, number>, before: number, after: number): void {
  const keys = Object.keys(byGoal);
  if (keys.length === 0 || before <= 0) return;
  let given = 0;
  for (const key of keys) {
    const value = Number(divRound(BigInt(byGoal[key]!) * BigInt(after), BigInt(before)));
    byGoal[key] = value;
    given += value;
  }
  const largest = keys.reduce((best, key) => (byGoal[key]! > byGoal[best]! ? key : best), keys[0]!);
  byGoal[largest] = byGoal[largest]! + (after - given);
}

/**
 * Units held per goal for one holding, from the goal tagged on each buy.
 * A sell takes units from the goal it names, never from another one.
 */
export function goalUnitsOf(trades: TradeRecord[], upTo?: string): GoalUnits {
  const byGoal: Record<string, number> = {};
  let unitsMicro = 0;

  for (const trade of [...trades].sort(byTradeOrder)) {
    if (upTo && trade.occurredOn > upTo) continue;
    const key = trade.goalId ?? UNTAGGED;
    if (trade.kind === 'buy') {
      byGoal[key] = (byGoal[key] ?? 0) + trade.unitsMicro;
      unitsMicro += trade.unitsMicro;
    } else if (trade.kind === 'sell') {
      const held = byGoal[key] ?? 0;
      if (trade.unitsMicro > held) {
        const whose = key === UNTAGGED ? 'Units with no goal' : `Goal "${key}"`;
        throw new GoalError(`${whose} holds ${formatUnits(held)}; enter up to ${formatUnits(held)}`);
      }
      byGoal[key] = held - trade.unitsMicro;
      unitsMicro -= trade.unitsMicro;
    } else if (trade.kind === 'unit_change') {
      const after = unitsMicro + trade.unitsMicro;
      scaleGoals(byGoal, unitsMicro, after);
      unitsMicro = after;
    }
  }

  for (const [key, value] of Object.entries(byGoal)) if (value <= 0) delete byGoal[key];
  return { byGoal, unitsMicro };
}

/** The same, for every holding that has trades. */
export function goalUnitsFor(trades: TradeRecord[], upTo?: string): Record<string, GoalUnits> {
  const byAccount = new Map<string, TradeRecord[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  return Object.fromEntries([...byAccount].map(([accountId, list]) => [accountId, goalUnitsOf(list, upTo)]));
}
