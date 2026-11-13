import type { NetWorthGroupView, NetWorthMarks, ShareSetting } from '@expanses/db';

/*
 * Household sharing, simplified (2026-11-13; review round 1): what the app does by itself for the household's net
 * worth, under one rule — nothing is ever shared without a tap on that person's own phone, and an existing household
 * looks exactly the same after updating.
 *
 * - The partner's Confirm, only of the very first group, filed separately: being in it shares nothing of the partner's
 *   (each item stays private until its own switch is on). Never a change of an active group (a new filing, leaving one
 *   tax ID), never one tax ID, and never after this person stopped sharing or declined: those wait for a tap, in the
 *   Tax report and under To fix.
 * - The review, only of a group filed separately, and only with the items this person switched on on this phone before
 *   the group was active (`intent`): nothing else is shared. One tax ID, and any group reviewed before this update,
 *   wait for the person's own tap.
 *
 * Pure. `watchNetWorthAutoSteps` (household.ts) runs them.
 */

/**
 * The proposal this phone confirms by itself, or null. `elsewhere`: the workspace of an active group this person is in,
 * when it is another one.
 */
export function autoConfirmOf(view: NetWorthGroupView | null, elsewhere: string | null, marks: Pick<NetWorthMarks, 'optedOut'>): string | null {
  const pending = view?.pending;
  if (!view || !pending || pending.cancelled) return null;
  if (elsewhere !== null || marks.optedOut) return null;
  // A change of a group already active is the members' to agree to, each with a tap.
  if (view.active !== null) return null;
  if (pending.mode !== 'separate') return null;
  if (!pending.members.includes(view.me) || !view.waitingFor.includes(view.me)) return null;
  return pending.proposalId;
}

/**
 * The review's settings when the app answers it: what this person switched on here is shared, every other item stays
 * private (a setting an earlier group left included). Null when nothing was switched on here: then the app does not
 * answer, and the review waits for the person.
 */
export function autoReviewSettings(items: readonly { accountId: string; setting: ShareSetting | null }[], intent: readonly string[]): Record<string, ShareSetting> | null {
  if (intent.length === 0) return null;
  const on = new Set(intent);
  return Object.fromEntries(items.map((item) => [item.accountId, on.has(item.accountId) ? 'total' : 'hidden'] as const));
}

/**
 * The others stopped sharing net worth: a group was seen on this phone, none is there now (nor one waiting), and it was
 * not this person who stopped. Then a Shared tap here starts nothing until the others start again from their phones.
 */
export function othersStopped(view: Pick<NetWorthGroupView, 'active' | 'pending'> | null, marks: Pick<NetWorthMarks, 'seen' | 'optedOut'>): boolean {
  if (!marks.seen || marks.optedOut) return false;
  return !view?.active && !(view?.pending && !view.pending.cancelled);
}
