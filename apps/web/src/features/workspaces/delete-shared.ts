import { type BookDeletePlan, LastOwnerError, LeaveIncompleteError, ownRecordsMessage, SyncTransportError } from '@expanses/db';
import { nameList } from '../sharing/sharing-copy';

/*
 * What Delete says for a workspace that is or was shared (sharing resilience spec §5.1 D-A8, D-A9), worked out away
 * from the sheet so every sentence is tested. Owner decision Q1: the purchases paid from this phone's own accounts are
 * kept in Personal unless the switch is turned off, so the one sentence about balances follows the switch.
 */

const KEPT_SENTENCE = "Purchases paid from accounts on this phone move to Personal, so those accounts' balances stay as they are.";
const ERASED_SENTENCE = "Purchases paid from accounts on this phone leave those accounts' balances.";

function balancesSentence(keep: boolean, ownPurchases: number): string {
  return keep && ownPurchases > 0 ? KEPT_SENTENCE : ERASED_SENTENCE;
}

function othersSentence(others: readonly string[]): string {
  if (others.length === 0) return 'No other copy is changed.';
  if (others.length === 1) return `${others[0]}'s copy is not changed.`;
  return `The copies of ${nameList(others)} are not changed.`;
}

export function leaveDeleteTitle(bookName: string): string {
  return `Leave and delete ${bookName}?`;
}

/** The one confirm of Leave and delete (§5.1, word for word with the switch off). `others` are the other members. */
export function leaveDeleteConfirm(input: { bookName: string; others: readonly string[]; keep: boolean; ownPurchases: number }): string {
  return `This phone leaves the share and ${input.bookName} is removed from this phone: every purchase, category and plan in it. ${balancesSentence(input.keep, input.ownPurchases)} ${othersSentence(input.others)} A safety copy is taken first.`;
}

/** Delete of a copy no longer shared here (left, stopped, removed, waiting for an invite): the same, without the leave. */
export function deleteCopyConfirm(input: { bookName: string; keep: boolean; ownPurchases: number }): string {
  return `${input.bookName} is removed from this phone: every purchase, category and plan in it. ${balancesSentence(input.keep, input.ownPurchases)} No other copy is changed. A safety copy is taken first.`;
}

export const KEEP_LABEL = 'Keep them in Personal';
/** Kept rows never travel (A5 fix round 4, R3-I1): said plainly beside the switch. */
export const NOT_SENT_NOTE = 'What is kept stays on this phone in Personal. It is not sent to anyone, even when Personal is shared.';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ownPurchasesLine(n: number, keep: boolean): string {
  if (!keep) return `${plural(n, 'purchase', 'purchases')} paid from own accounts ${n === 1 ? 'is' : 'are'} erased, and those accounts' balances change`;
  return `${plural(n, 'purchase', 'purchases')} paid from own accounts ${n === 1 ? 'moves' : 'move'} to Personal`;
}

export function ownRecordsLine(n: number): string {
  return `${plural(n, 'trade or sale', 'trades or sales')} ${n === 1 ? 'is' : 'are'} kept in Personal`;
}

/** Purchases the copy holds that a new share already carries (A6 fix): they come back through it, not through the keep. */
export function arrivingLine(n: number): string {
  return `${plural(n, 'purchase', 'purchases')} will come back through the new share`;
}

/**
 * Why Delete cannot run, in the plan's own words: any refusal but the active copy's (which Leave and delete answers by
 * leaving), and the keep switch turned off over own trades or sales (A5 fix round 2). Null when Delete may run.
 */
export function deleteRefusal(
  plan: Pick<BookDeletePlan, 'refusal' | 'refusalCode' | 'ownRecords'>,
  keep: boolean,
  options: { leaving?: boolean } = {},
): string | null {
  if (plan.refusal && !(options.leaving && plan.refusalCode === 'SHARED')) return plan.refusal;
  if (plan.ownRecords > 0 && !keep) return ownRecordsMessage(plan.ownRecords);
  return null;
}

export const DELETE_HERE_ONLY_ASK = 'Leaving needs a connection. Delete here only? The share will still list this phone until an owner removes it.';
export const DELETE_HERE_ONLY_LABEL = 'Delete here only';
export const LAST_OWNER_LINE = 'Make someone else an owner first.';

/** Whether a failed Leave failed for want of the relay: then Delete here only is offered (§5.1). */
export function leaveNeedsConnection(error: unknown): boolean {
  if (error instanceof LeaveIncompleteError) return leaveNeedsConnection(error.cause);
  if (error instanceof SyncTransportError) return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof Error && /relay unreachable|Failed to fetch|NetworkError|Load failed/i.test(error.message);
}

/** What the Leave and delete sheet shows after a failed leave: the owner step, Delete here only, or the error. */
export function deleteStep(error: unknown): 'last-owner' | 'here-only' | 'error' {
  if (error instanceof LastOwnerError) return 'last-owner';
  return leaveNeedsConnection(error) ? 'here-only' : 'error';
}
