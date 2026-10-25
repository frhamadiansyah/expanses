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
