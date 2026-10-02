import { type GoalStatus, goalStatusOf } from '@expanses/core';

/**
 * The arithmetic behind a goal page's Use, Take back, Move and Monthly: what each leaves set aside, and what the
 * month reads after. Pure, so the sheets only draw what this decides. Every figure is in one account's own money.
 */

export interface GoalEarmark {
  goalId: string;
  accountId: string;
  amountMinor: number;
}

/** A typed figure that is no figure — empty, unreadable, nought or below — counts as nothing. */
const figure = (minor: number | null | undefined) => (minor !== null && minor !== undefined && Number.isFinite(minor) && minor > 0 ? Math.floor(minor) : 0);

/**
 * What a spend or a take-back lowers a set-aside by, and what is left: never more than is set aside, never below
 * nought. Spending more than is set aside is still a spend — the rest is ordinary money — but the goal only gives up
 * what it had.
 */
export function lowered(setAsideMinor: number, amountMinor: number | null): { takenMinor: number; leftMinor: number } {
  const held = figure(setAsideMinor);
  const takenMinor = Math.min(figure(amountMinor), held);
  return { takenMinor, leftMinor: held - takenMinor };
}

/**
 * A move from one goal's set-aside to another's on the same account: what moves (no more than the source holds),
 * and both sides after.
 */
export function moved(sourceMinor: number, targetMinor: number, amountMinor: number | null): { movedMinor: number; sourceLeftMinor: number; targetAfterMinor: number } {
  const { takenMinor, leftMinor } = lowered(sourceMinor, amountMinor);
  return { movedMinor: takenMinor, sourceLeftMinor: leftMinor, targetAfterMinor: figure(targetMinor) + takenMinor };
}

/** This goal's set-asides that hold something, in the order the earmarks came. */
export function setAsideOf(earmarks: readonly GoalEarmark[], goalId: string): GoalEarmark[] {
  return earmarks.filter((earmark) => earmark.goalId === goalId && earmark.amountMinor > 0);
}

/** What this goal has set aside on one account, or nought. */
export function setAsideOn(earmarks: readonly GoalEarmark[], goalId: string, accountId: string): number {
  return earmarks.find((earmark) => earmark.goalId === goalId && earmark.accountId === accountId)?.amountMinor ?? 0;
}

/** Accounts holding money set aside for the goal first, the rest after, each keeping the order it came in. */
export function setAsideFirst<T extends { id: string }>(accounts: readonly T[], earmarks: readonly GoalEarmark[], goalId: string): T[] {
  const holds = new Set(setAsideOf(earmarks, goalId).map((earmark) => earmark.accountId));
  return [...accounts.filter((account) => holds.has(account.id)), ...accounts.filter((account) => !holds.has(account.id))];
}

/**
 * Everything set aside for the goal once one account's set-aside is lowered, added up per currency (a dollar
 * set-aside is never added to a rupiah one). Currencies come in the order their first account does.
 */
export function leftForGoal(
  accounts: readonly { accountId: string; currency: string; amountMinor: number }[],
  loweredAccountId: string | null,
  takenMinor: number,
): { currency: string; amountMinor: number }[] {
  const out: { currency: string; amountMinor: number }[] = [];
  for (const account of accounts) {
    const minor = Math.max(0, account.amountMinor - (account.accountId === loweredAccountId ? figure(takenMinor) : 0));
    const row = out.find((line) => line.currency === account.currency);
    if (row) row.amountMinor += minor;
    else out.push({ currency: account.currency, amountMinor: minor });
  }
  return out;
}

/**
 * What the Monthly sheet opens on: the standing amount as it is, or — when nothing at all is set up for the goal yet
 * — what it needs a month, so the one figure that puts it on track is already there.
 */
export function monthlyPrefill(neededMonthlyMinor: number, plannedMonthlyMinor: number, standingMonthlyMinor: number): number {
  return plannedMonthlyMinor === 0 ? Math.max(0, neededMonthlyMinor) : standingMonthlyMinor;
}

/**
 * The month after a new standing amount. What is set up counts the monthly buys as well as the standing amount, so
 * only the standing part is swapped; the status is the plan's own rule (`goalStatusOf`).
 */
export function monthlyAfter(
  neededMonthlyMinor: number,
  plannedMonthlyMinor: number,
  standingMonthlyMinor: number,
  nextStandingMinor: number | null,
): { plannedMonthlyMinor: number; status: GoalStatus } {
  const planned = Math.max(0, plannedMonthlyMinor - standingMonthlyMinor) + figure(nextStandingMinor);
  return { plannedMonthlyMinor: planned, status: goalStatusOf(neededMonthlyMinor, planned) };
}

export const STATUS_WORDS: Record<GoalStatus, string> = { funded: 'Funded', on_track: 'On track', behind: 'Behind' };

/**
 * What a tagged purchase is worth to the goal today: its share of the units the goal holds in that holding, valued
 * as the goal's link is. Sells taken from the goal leave fewer units than were bought, so a purchase is never worth
 * more than everything the goal holds there.
 */
export function purchaseShare(purchaseUnitsMicro: number, goalUnitsMicro: number, goalValueMinor: number): number {
  if (!(goalUnitsMicro > 0) || !(purchaseUnitsMicro > 0)) return 0;
  return Math.round((Math.min(purchaseUnitsMicro, goalUnitsMicro) / goalUnitsMicro) * goalValueMinor);
}
