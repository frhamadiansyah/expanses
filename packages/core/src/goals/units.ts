import { moneySells } from '../assets/by-money';
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

/** Money put in per goal for one holding tracked by money, with untagged money under `UNTAGGED`. */
export interface GoalMoney {
  byGoal: Record<string, number>;
  /** The money still in the holding: the sum of every goal's. */
  costMinor: number;
}

/** Whether a holding's trades are tracked by money: a buy or sell with no units, or one saved with its cost. */
export const tradedByMoney = (trades: readonly TradeRecord[]): boolean =>
  trades.some((trade) => (trade.kind === 'buy' || trade.kind === 'sell') && (trade.unitsMicro <= 0 || trade.basisMinor != null));

/**
 * Money put in per goal for a holding tracked by money (spec 2026-10-19-fund-by-amount): a buy tagged to a goal adds
 * what it cost to that goal; a sell named to a goal takes the money it gave up out of that goal alone, and cannot take
 * more than the goal has in. A goal's value is then its share of the holding's value, by money put in.
 */
export function goalMoneyOf(trades: readonly TradeRecord[], upTo?: string): GoalMoney {
  const sells = moneySells(trades);
  const byGoal: Record<string, number> = {};
  let costMinor = 0;
  for (const trade of [...trades].sort(byTradeOrder)) {
    if (upTo && trade.occurredOn > upTo) continue;
    const key = trade.goalId ?? UNTAGGED;
    if (trade.kind === 'buy') {
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      byGoal[key] = (byGoal[key] ?? 0) + cost;
      costMinor += cost;
    } else if (trade.kind === 'sell') {
      const basis = sells.get(trade.id)?.basisMinor ?? 0;
      const held = byGoal[key] ?? 0;
      // A rupiah of rounding is the holding's, not a goal overdrawn.
      if (basis > held + 1) {
        const whose = key === UNTAGGED ? 'Money with no goal' : `Goal "${key}"`;
        throw new GoalError(`${whose} has less in this holding than that sell takes out`);
      }
      byGoal[key] = Math.max(0, held - basis);
      costMinor -= Math.min(basis, held);
    }
  }
  for (const [key, value] of Object.entries(byGoal)) if (value <= 0) delete byGoal[key];
  return { byGoal, costMinor };
}

/** The same, for every holding that has trades. */
export function goalUnitsFor(trades: TradeRecord[], upTo?: string): Record<string, GoalUnits> {
  const byAccount = new Map<string, TradeRecord[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  return Object.fromEntries([...byAccount].map(([accountId, list]) => [accountId, goalUnitsOf(list, upTo)]));
}

/** Stands for "some other goal" when a retag is tried out: a goal gaining units can never oversell. */
const ELSEWHERE = '\u0000elsewhere';

/**
 * Whether a buy can be retagged without leaving any goal holding fewer units than it later sells. `trades` are the
 * holding's own; `goalId` is the new tag (null for none), or left out to ask about a move to any other goal — only the
 * goal the buy leaves can fall short, so one answer covers them all.
 */
export function retagFits(trades: readonly TradeRecord[], tradeId: string, goalId?: string | null): boolean {
  const to = goalId === undefined ? ELSEWHERE : goalId;
  const moved = trades.map((trade) => (trade.id === tradeId ? { ...trade, goalId: to } : trade));
  try {
    // A holding tracked by money is shared out by money put in; one counted in units, by units.
    if (tradedByMoney(trades)) goalMoneyOf(moved);
    else goalUnitsOf(moved);
    return true;
  } catch (e) {
    if (e instanceof GoalError) return false;
    throw e;
  }
}
