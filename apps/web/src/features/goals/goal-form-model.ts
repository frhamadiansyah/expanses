import { formatMinor } from '@expanses/core';
import type { GoalEditBase, GoalRow } from '@expanses/db';

/**
 * The goal form's decisions that are not drawing: which accounts can still be added to Money set aside, what the
 * save writes for them, and whether the page may be saved yet.
 */

/** The accounts not yet in the group, in the order the book keeps them. */
export function addableAccounts<T extends { id: string }>(eligible: readonly T[], added: readonly string[]): T[] {
  const taken = new Set(added);
  return eligible.filter((account) => !taken.has(account.id));
}

/** The rows a saved goal opens with: every account it already holds money in, in the order the earmarks came. */
export function addedFromEarmarks(earmarks: readonly { goalId: string; accountId: string; amountMinor: number }[], goalId: string | undefined): string[] {
  if (!goalId) return [];
  return earmarks.filter((earmark) => earmark.goalId === goalId && earmark.amountMinor > 0).map((earmark) => earmark.accountId);
}

/** True when the typed figure is nothing: empty, or digits that are all noughts. */
export const isNoAmount = (typed: string) => typed.trim() === '' || Number(typed.replace(/[^\d]/g, '')) === 0;

export interface SetAsideWrite {
  accountId: string;
  /** `save` writes the figure; `remove` clears whatever the goal held there. */
  action: 'save' | 'remove';
  text: string;
}

/**
 * What saving writes: a figure for each added account that has one, and a clearing for every other eligible
 * account, so a row removed from the group (or emptied) lets go of its money.
 */
export function setAsideWrites(eligibleIds: readonly string[], added: readonly string[], text: (accountId: string) => string): SetAsideWrite[] {
  const inGroup = new Set(added);
  return eligibleIds.map((accountId) => {
    const typed = inGroup.has(accountId) ? text(accountId) : '';
    return isNoAmount(typed) ? { accountId, action: 'remove' as const, text: '' } : { accountId, action: 'save' as const, text: typed };
  });
}

/**
 * The name a goal's only payment is saved under. The form shows no What row for one payment, so the payment is the
 * goal itself and takes the goal's name. A saved goal's payment keeps a name of its own (one that is not the goal's
 * saved name), so editing never renames what the goal page already shows.
 */
export function onlyPaymentName(goalName: string, stageName: string, savedGoalName: string | undefined): string {
  if (savedGoalName !== undefined && stageName.trim() !== '' && stageName !== savedGoalName) return stageName;
  return goalName.trim();
}

/** The Money set aside row's answer: "None", the total when the rows share a currency, otherwise how many accounts hold it. */
export function setAsideSummary(entries: readonly { currency: string; minor: number }[]): string {
  const held = entries.filter((entry) => entry.minor > 0);
  if (held.length === 0) return 'None';
  const currencies = new Set(held.map((entry) => entry.currency));
  if (currencies.size === 1) return formatMinor(held.reduce((sum, entry) => sum + entry.minor, 0), held[0]!.currency);
  return `${held.length} accounts`;
}

/** The Assumptions row's answer: "Growth 5% · Return 4%". A figure not typed yet reads as nothing. */
export function assumptionsSummary(growth: string, expectedReturn: string): string {
  const figure = (typed: string) => (typed.trim() === '' ? '0' : typed.trim());
  return `Growth ${figure(growth)}% · Return ${figure(expectedReturn)}%`;
}

export interface StageText {
  name: string;
  amount: string;
  months: string;
  usesMonths: boolean;
}

/** The page's ✓ waits for a name, and for every payment to say what it is and how much. */
export function canSaveGoal(name: string, stages: readonly StageText[]): boolean {
  if (name.trim() === '' || stages.length === 0) return false;
  return stages.every((stage) => stage.name.trim() !== '' && (stage.usesMonths ? stage.months.trim() !== '' : stage.amount.trim() !== ''));
}

/**
 * The goal as Edit goal opened on it, kept for the save (final review I1): the save writes only what differs from it,
 * so a payment another phone marked paid or added while the form was open is not undone. Taken once, when the form
 * opens — the goal it is given later already holds the other phone's change.
 */
export function editBaseOf(goal: GoalRow): GoalEditBase {
  return {
    name: goal.name,
    kind: goal.kind,
    growthBps: goal.growthBps,
    returnBps: goal.returnBps,
    currency: goal.currency,
    stages: goal.stages.map(({ id, name, targetMinor, targetMonths, dueOn, paidOn }) => ({ id, name, targetMinor, targetMonths, dueOn, paidOn })),
  };
}
