import type { NetWorthGroupView, ShareSetting } from '@expanses/db';

/*
 * Household sharing, simplified (2026-11-13): the two steps the old Net worth setup asked for by hand happen by
 * themselves, through the same actions the buttons ran.
 *
 * - The partner's Confirm: a group filed separately shares nothing of the partner's by being confirmed (each item stays
 *   private until its own Shared switch is on), so their phone confirms it as soon as it arrives. One tax ID shares
 *   every item: it is never confirmed here, but asked in the tax report.
 * - The review: an activation sends nothing until the person's review (`sendAllowance`). It is answered with exactly
 *   what was chosen — on the phone that switched the first account on, what it stored when it did; on the other, only
 *   what the partner already sees — so nothing goes out that nobody switched on.
 *
 * Pure: which proposal to confirm and what the review says. `watchNetWorthAutoSteps` (the App) runs them.
 */

/** The proposal this phone confirms by itself, or null. `elsewhere`: the workspace of an active group this person is in, when it is another one. */
export function autoConfirmOf(view: NetWorthGroupView | null, elsewhere: string | null): string | null {
  const pending = view?.pending;
  if (!view || !pending || pending.cancelled) return null;
  if (elsewhere !== null) return null;
  if (pending.mode !== 'separate') return null;
  if (!pending.members.includes(view.me) || !view.waitingFor.includes(view.me)) return null;
  return pending.proposalId;
}

/**
 * The review's settings, item by item. `proposer`: this phone proposed the active group — its stored settings are what
 * was switched on since (the start writes every other item private). Otherwise only what is live in the group's log
 * (what the partner sees now) stays shared. `now` overrides an item or two: a switch turned just now.
 */
export function autoReviewSettings(
  items: readonly { accountId: string; setting: ShareSetting | null }[],
  from: { proposer: boolean; live: ReadonlySet<string> },
  now: Readonly<Record<string, ShareSetting>> = {},
): Record<string, ShareSetting> {
  const out: Record<string, ShareSetting> = {};
  for (const item of items) {
    const kept = item.setting === 'total' && (from.proposer || from.live.has(item.accountId));
    out[item.accountId] = now[item.accountId] ?? (kept ? 'total' : 'hidden');
  }
  return out;
}
