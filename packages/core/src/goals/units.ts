import { moneySells } from '../assets/by-money';
import type { GoalPart, TradeRecord } from '../assets/position';
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

/** Whether a trade is split between goals: two or more parts, each with something in it. */
export const isSplit = (trade: Pick<TradeRecord, 'goalParts'>): boolean => (trade.goalParts?.length ?? 0) > 0;

/**
 * A trade's units by goal: each part's, then what no part took under `UNTAGGED`; or, not split, all of it under the
 * goal it names. Never negative — a split is refused when saved if its parts take more than the trade.
 */
export function unitsByGoal(trade: TradeRecord): [string, number][] {
  if (!isSplit(trade)) return [[trade.goalId ?? UNTAGGED, trade.unitsMicro]];
  const parts = trade.goalParts!.map((part): [string, number] => [part.goalId, part.unitsMicro]);
  const rest = trade.unitsMicro - parts.reduce((sum, [, units]) => sum + units, 0);
  return rest > 0 ? [...parts, [UNTAGGED, rest]] : parts;
}

/**
 * Shares `totalMinor` out between a trade's goals — what a split buy cost each goal, fee and tax included, or the money
 * a split sell takes from each. In proportion to each part's amount of the gross when the parts carry amounts (a fund
 * tracked by money), else to its units; the rounding goes to the largest share, so the shares always add up exactly.
 */
export function goalShares(trade: TradeRecord, totalMinor: number): [string, number][] {
  if (!isSplit(trade)) return [[trade.goalId ?? UNTAGGED, totalMinor]];
  const byMoney = trade.goalParts!.some((part) => part.moneyMinor > 0);
  const weightOf = (part: GoalPart) => (byMoney ? part.moneyMinor : part.unitsMicro);
  const whole = byMoney ? trade.grossMinor : trade.unitsMicro;
  const weights: [string, number][] = trade.goalParts!.map((part) => [part.goalId, weightOf(part)]);
  const rest = whole - weights.reduce((sum, [, weight]) => sum + weight, 0);
  if (rest > 0) weights.push([UNTAGGED, rest]);
  const sum = weights.reduce((total, [, weight]) => total + weight, 0);
  if (sum <= 0) return [[UNTAGGED, totalMinor]];
  const shares = weights.map(([key, weight]): [string, number] => [key, Number(divRound(BigInt(totalMinor) * BigInt(weight), BigInt(sum)))]);
  const given = shares.reduce((total, [, minor]) => total + minor, 0);
  const largest = shares.reduce((best, share, index) => (share[1] > shares[best]![1] ? index : best), 0);
  shares[largest] = [shares[largest]![0], shares[largest]![1] + (totalMinor - given)];
  return shares;
}

/**
 * Whether a split fits its trade: every part names a goal once, takes something, and together they take no more than
 * the trade — its units, or (by money) its gross.
 */
export function splitFits(trade: Pick<TradeRecord, 'unitsMicro' | 'grossMinor'>, parts: readonly GoalPart[], byMoney: boolean): boolean {
  const goals = new Set(parts.map((part) => part.goalId));
  if (goals.size !== parts.length || parts.some((part) => !part.goalId)) return false;
  if (parts.some((part) => (byMoney ? part.moneyMinor : part.unitsMicro) <= 0 || part.unitsMicro < 0 || part.moneyMinor < 0)) return false;
  const taken = parts.reduce((sum, part) => sum + (byMoney ? part.moneyMinor : part.unitsMicro), 0);
  return taken <= (byMoney ? trade.grossMinor : trade.unitsMicro);
}

/**
 * Units held per goal for one holding, from the goal tagged on each buy — or each goal's part of a split one.
 * A sell takes units from the goal it names, or from each goal its parts name, never from another one.
 */
export function goalUnitsOf(trades: TradeRecord[], upTo?: string): GoalUnits {
  const byGoal: Record<string, number> = {};
  let unitsMicro = 0;

  for (const trade of [...trades].sort(byTradeOrder)) {
    if (upTo && trade.occurredOn > upTo) continue;
    if (trade.kind === 'buy') {
      for (const [key, units] of unitsByGoal(trade)) byGoal[key] = (byGoal[key] ?? 0) + units;
      unitsMicro += trade.unitsMicro;
    } else if (trade.kind === 'sell') {
      for (const [key, units] of unitsByGoal(trade)) {
        const held = byGoal[key] ?? 0;
        if (units > held) {
          const whose = key === UNTAGGED ? 'Units with no goal' : `Goal "${key}"`;
          throw new GoalError(`${whose} holds ${formatUnits(held)}; enter up to ${formatUnits(held)}`);
        }
        byGoal[key] = held - units;
      }
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
    if (trade.kind === 'buy') {
      const cost = trade.grossMinor + trade.feeMinor + trade.taxMinor;
      for (const [key, share] of goalShares(trade, cost)) byGoal[key] = (byGoal[key] ?? 0) + share;
      costMinor += cost;
    } else if (trade.kind === 'sell') {
      for (const [key, basis] of goalShares(trade, sells.get(trade.id)?.basisMinor ?? 0)) {
        const held = byGoal[key] ?? 0;
        /* A rupiah of rounding is the holding's, not a goal overdrawn. A sell from the units days (saved with no cost)
           was checked by units when it was saved; by money its average cost can be more than its goal put in, and that
           history stands — it empties the goal rather than refusing. */
        if (basis > held + 1 && trade.basisMinor != null) {
          const whose = key === UNTAGGED ? 'Money with no goal' : `Goal "${key}"`;
          throw new GoalError(`${whose} has less in this holding than that sell takes out`);
        }
        byGoal[key] = Math.max(0, held - basis);
        costMinor -= Math.min(basis, held);
      }
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
  return walks(trades.map((trade) => (trade.id === tradeId ? { ...trade, goalId: to, goalParts: null } : trade)), trades);
}

/**
 * Whether a trade can be split this way (or, with no parts, given back to one goal) without leaving any goal holding
 * less than it later sells — and whether the parts fit the trade at all.
 */
export function resplitFits(trades: readonly TradeRecord[], tradeId: string, parts: readonly GoalPart[]): boolean {
  const trade = trades.find((row) => row.id === tradeId);
  if (!trade) return false;
  if (parts.length > 0 && !splitFits(trade, parts, tradedByMoney(trades))) return false;
  const moved = trades.map((row) => (row.id === tradeId ? { ...row, goalId: null, goalParts: parts.length > 0 ? parts : null } : row));
  return walks(moved, trades);
}

/** Walks the holding with one trade changed: true when no goal is left short. */
function walks(moved: readonly TradeRecord[], trades: readonly TradeRecord[]): boolean {
  try {
    // A holding tracked by money is shared out by money put in; one counted in units, by units.
    if (tradedByMoney(trades)) goalMoneyOf(moved);
    else goalUnitsOf([...moved]);
    return true;
  } catch (e) {
    if (e instanceof GoalError) return false;
    throw e;
  }
}
