/*
 * The Share page's one Sync row (2026-11-13, redesign A1): quiet ("Up to date") when nothing needs doing, a red count
 * when something does. What it counts is listed under "To fix" on Sync details, each with where it is fixed — the
 * warnings the Share page used to show in boxes and footers. Pure: the screens read the inputs, this says the problems.
 */

export type ProblemFix =
  /** A share this phone lost: Discard old share (§6.2, §7). */
  | { kind: 'discard' }
  /** Rows set aside whose holder is gone: Place them now (§4.3). */
  | { kind: 'place' }
  /** Another copy here holds part of this share: its workspace page, where it is deleted (review I-2). */
  | { kind: 'holder'; bookId: string }
  /** A share dead here, or whose owners went quiet: Keep as own copy (C1, D-A11). */
  | { kind: 'forget' }
  /** The last run failed: Sync now. */
  | { kind: 'sync' }
  /** Net worth asked of this phone (a first group, a change of filing): Confirm or Choose differently in the Tax report. */
  | { kind: 'tax' }
  /** A net worth review this person has yet to answer: the Shared with list. */
  | { kind: 'review' };

export interface SyncProblem {
  key: string;
  title: string;
  subtitle: string | null;
  fix: ProblemFix | null;
}

export interface ProblemInput {
  bookName: string;
  /** This phone lost its share of the workspace. */
  lost: boolean;
  /** "Last sync failed: …", while runs keep failing. */
  failedLine: string | null;
  /** The rows another copy here holds, in words (`heldLineOf`). */
  heldText: string | null;
  /** Every holder of those rows is gone: they can be placed now. */
  placeable: boolean;
  /** The copies here that hold part of this share. */
  holders: readonly { bookId: string; label: string }[];
  /** Keep as own copy is the way on (ended, frozen, or owners quiet). */
  forgettable: boolean;
  /** What says why it is (`forgetConfirm` / owners quiet), shown under the row. */
  forgetLine: string | null;
  /** The other side has been quiet a long time (`shareSilenceLine`). */
  silenceText: string | null;
  /** Each other phone still in the share on an app too old to keep in step. */
  outdated: readonly { name: string; version: string | null }[];
  /** Net worth asked of this phone, in words ("Rina set up household net worth: one tax ID."), or null. */
  netWorthAsked?: string | null;
  /** The active group's review is this person's to answer. */
  reviewDue?: boolean;
}

export const KEEP_OWN_PROBLEM = 'Keep this copy on its own';

export function syncProblemsOf(input: ProblemInput): SyncProblem[] {
  const out: SyncProblem[] = [];
  if (input.lost) out.push({ key: 'lost', title: `${input.bookName} lost its share on this phone`, subtitle: 'Records here are safe. Discard the old share to share it again.', fix: { kind: 'discard' } });
  if (input.failedLine) out.push({ key: 'failed', title: 'Not syncing', subtitle: input.failedLine, fix: { kind: 'sync' } });
  if (input.heldText) out.push({ key: 'held', title: input.heldText, subtitle: input.placeable ? 'Place them now' : null, fix: input.placeable ? { kind: 'place' } : null });
  for (const holder of input.holders) out.push({ key: `holder:${holder.bookId}`, title: `${holder.label} holds part of this share`, subtitle: 'Open it to delete it', fix: { kind: 'holder', bookId: holder.bookId } });
  if (input.silenceText) out.push({ key: 'silence', title: input.silenceText, subtitle: null, fix: null });
  for (const phone of input.outdated) out.push({ key: `outdated:${phone.name}`, title: `${phone.name}’s phone is on ${phone.version ?? 'an older version'}`, subtitle: 'Update the app on it', fix: null });
  if (input.netWorthAsked) out.push({ key: 'nw-asked', title: input.netWorthAsked, subtitle: 'Confirm or choose differently in the Tax report', fix: { kind: 'tax' } });
  if (input.reviewDue) out.push({ key: 'nw-review', title: 'Net worth waits for a review', subtitle: 'Nothing new is shared until it is answered', fix: { kind: 'review' } });
  if (input.forgettable) out.push({ key: 'forget', title: KEEP_OWN_PROBLEM, subtitle: input.forgetLine, fix: { kind: 'forget' } });
  return out;
}

/** The Sync row's value when nothing needs fixing. */
export function syncRowValue(input: { running: boolean; waiting: number }): string {
  if (input.running) return 'Syncing…';
  if (input.waiting > 0) return `${input.waiting} waiting to send`;
  return 'Up to date';
}
