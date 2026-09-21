/**
 * Money set aside for goals, against the money actually free to spend.
 *
 * Everything here is in **one account's own currency**. Nothing converts and nothing adds a figure from one account to
 * a figure from another: an account's promises, its balance and what leaves it are all the same money. A promise is
 * not a balance — nothing here changes what the account holds, only what the app calls free.
 */

export interface SetAsideClaim {
  goalId: string;
  name: string;
  /** The goal's place in the owner's order: 0 is funded first. */
  rank: number;
  /** What the goal has set aside on this account (`goal_earmarks.amount_minor`). */
  promisedMinor: number;
}

export interface BorrowMark {
  goalId: string;
  amountMinor: number;
  occurredOn: string;
  createdAt: string;
}

export interface GoalShare {
  goalId: string;
  name: string;
  rank: number;
  promisedMinor: number;
  coveredMinor: number;
  shortMinor: number;
  /** The part of `shortMinor` this goal's own borrows on the account explain. */
  borrowedShortMinor: number;
}

export type SetAsideState = 'none' | 'covered' | 'short';

export interface AccountSetAside {
  balanceMinor: number;
  setAsideMinor: number;
  /** Balance minus what is set aside. Signed: below nought when more is promised than is held. */
  freeMinor: number;
  shortMinor: number;
  state: SetAsideState;
  /** Every goal promised on the account, first-ranked first. */
  goals: GoalShare[];
}

/**
 * One account's promises against what it holds.
 *
 * A shortage is shared out in two passes: first to the goals that were borrowed from on this account, the most recent
 * borrow first, each up to what it borrowed; then to the rest, lowest priority first. It is worked out fresh every
 * time, so a top-up shrinks a borrowed shortfall without anything being written.
 */
export function setAsideOn(balanceMinor: number, claims: readonly SetAsideClaim[], borrows: readonly BorrowMark[]): AccountSetAside {
  const live = claims.filter((claim) => claim.promisedMinor > 0);
  const setAsideMinor = live.reduce((total, claim) => total + claim.promisedMinor, 0);
  const shortMinor = Math.max(0, setAsideMinor - Math.max(0, balanceMinor));
  const byPriority = [...live].sort((a, b) => a.rank - b.rank || a.goalId.localeCompare(b.goalId));
  const promised = new Map(live.map((claim) => [claim.goalId, claim.promisedMinor]));
  const short = new Map<string, number>();
  const borrowed = new Map<string, number>();
  let left = shortMinor;

  const latest = new Map<string, string>();
  const lent = new Map<string, number>();
  for (const mark of borrows) {
    if (!promised.has(mark.goalId)) continue;
    const key = `${mark.occurredOn} ${mark.createdAt}`;
    if ((latest.get(mark.goalId) ?? '') < key) latest.set(mark.goalId, key);
    lent.set(mark.goalId, (lent.get(mark.goalId) ?? 0) + mark.amountMinor);
  }
  const borrowOrder = [...latest.entries()].sort((a, b) => b[1].localeCompare(a[1]) || b[0].localeCompare(a[0])).map(([goalId]) => goalId);
  for (const goalId of borrowOrder) {
    if (left === 0) break;
    const take = Math.min(left, promised.get(goalId)!, lent.get(goalId)!);
    short.set(goalId, take);
    borrowed.set(goalId, take);
    left -= take;
  }
  for (const claim of [...byPriority].reverse()) {
    if (left === 0) break;
    const take = Math.min(left, claim.promisedMinor - (short.get(claim.goalId) ?? 0));
    if (take <= 0) continue;
    short.set(claim.goalId, (short.get(claim.goalId) ?? 0) + take);
    left -= take;
  }

  return {
    balanceMinor,
    setAsideMinor,
    freeMinor: balanceMinor - setAsideMinor,
    shortMinor,
    state: setAsideMinor === 0 ? 'none' : shortMinor > 0 ? 'short' : 'covered',
    goals: byPriority.map((claim) => ({
      goalId: claim.goalId,
      name: claim.name,
      rank: claim.rank,
      promisedMinor: claim.promisedMinor,
      coveredMinor: claim.promisedMinor - (short.get(claim.goalId) ?? 0),
      shortMinor: short.get(claim.goalId) ?? 0,
      borrowedShortMinor: borrowed.get(claim.goalId) ?? 0,
    })),
  };
}

export type SetAsideCheck =
  | { kind: 'silent' }
  | { kind: 'already-short'; shortMinor: number }
  | { kind: 'ask'; overMinor: number; freeMinor: number; goals: GoalShare[] };

/**
 * The one rule every door asks: warn only when the movement takes more than is free on the account.
 *
 * `ownGoalId` is the goal the movement is *for* — a buy tagged to it, a transfer parked for it. That goal's own covered
 * money on this account is its to use, so it counts as room, and it is not offered as a goal to take from.
 * An account that already holds less than it promises is its own state and is not asked about again.
 */
export function checkOutflow(view: AccountSetAside, outflowMinor: number, ownGoalId: string | null = null): SetAsideCheck {
  if (view.state === 'none' || outflowMinor <= 0) return { kind: 'silent' };
  if (view.state === 'short') return { kind: 'already-short', shortMinor: view.shortMinor };
  const own = ownGoalId ? (view.goals.find((goal) => goal.goalId === ownGoalId)?.coveredMinor ?? 0) : 0;
  const free = Math.max(0, view.freeMinor);
  if (outflowMinor <= free + own) return { kind: 'silent' };
  const goals = view.goals.filter((goal) => goal.goalId !== ownGoalId);
  if (goals.length === 0) return { kind: 'silent' };
  return { kind: 'ask', overMinor: outflowMinor - free - own, freeMinor: free, goals };
}

export interface MoneyLine {
  accountId: string;
  amountMinor: number;
}

const netOn = (lines: readonly MoneyLine[], accountId: string) =>
  lines.filter((line) => line.accountId === accountId).reduce((total, line) => total + line.amountMinor, 0);

/** What left an account in a posting: its signed lines summed, then clamped at nought. */
export function outflowFrom(lines: readonly MoneyLine[], accountId: string): number {
  return Math.max(0, -netOn(lines, accountId));
}

/** What reached an account in a posting: its signed lines summed, then clamped at nought. */
export function inflowTo(lines: readonly MoneyLine[], accountId: string): number {
  return Math.max(0, netOn(lines, accountId));
}

/** A promise moved by a transfer, at the transfer's own rate, floored. BigInt: the product passes 2^53 on real sums. */
export function movedAmount(movedMinor: number, outflowMinor: number, inflowMinor: number): number {
  if (movedMinor <= 0 || outflowMinor <= 0 || inflowMinor <= 0) return 0;
  return Number((BigInt(movedMinor) * BigInt(inflowMinor)) / BigInt(outflowMinor));
}

/** Several payments from one account, in order: how much of each goes over the room left. Sums to max(0, total − room). */
export function spreadOver(amounts: readonly number[], roomMinor: number): number[] {
  let cumulative = 0;
  return amounts.map((amount) => {
    cumulative += amount;
    return Math.max(0, Math.min(amount, cumulative - roomMinor));
  });
}

export interface DatedAmount {
  occurredOn: string;
  amountMinor: number;
}

/**
 * The day a goal's set-aside last rose to its target, walking its dated changes back from today's total.
 *
 * Null when the goal is not whole, when the records run out while it is still whole (it was whole before they begin),
 * or when the walk reaches a day before `notBefore` — an earlier borrow, after which the day it was whole again is not
 * recorded anywhere.
 */
export function wholeSince(events: readonly DatedAmount[], currentMinor: number, targetMinor: number, notBefore: string | null): string | null {
  if (targetMinor <= 0 || currentMinor < targetMinor) return null;
  const ordered = [...events].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  let total = currentMinor;
  for (const event of ordered) {
    if (notBefore !== null && event.occurredOn < notBefore) return null;
    const before = total - event.amountMinor;
    if (before < targetMinor) return event.occurredOn;
    total = before;
  }
  return null;
}
