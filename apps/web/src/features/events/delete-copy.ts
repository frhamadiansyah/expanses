import type { EventCopyPlan, SharedEventView } from '@expanses/db';

/*
 * Delete this copy (owner report 2026-11-12): the read-only copy of a shared event this phone's person is no longer in
 * comes off this phone alone (`deleteEventCopy`). The words name the person and never say "you" (the owner's rule).
 */

export const DELETE_COPY_LABEL = 'Delete this copy';

/** Said only when the copy holds records made here that the others never got (fix round 1, review minor 3). */
const NEVER_SENT = 'Some records made on this phone never reached the others; the safety copy taken first keeps them.';

/** The one confirm before the copy goes. */
export function deleteCopyConfirm(view: Pick<SharedEventView, 'name' | 'myName'>, plan: Pick<EventCopyPlan, 'unsentHere'>): string {
  const asked = `Delete this copy of ${view.name}? ${view.myName} is no longer in it. What was recorded stays with the others.`;
  return plan.unsentHere > 0 ? `${asked} ${NEVER_SENT}` : asked;
}

/**
 * The delete, in its order: the plan (`planEventCopyDelete`) — a refusal, a balance not at zero say, is thrown in its
 * own words and nothing is asked — then the confirm, the safety copy (`useSafetyCopy('before-delete')`, as a
 * workspace's Delete takes it), and only then the delete. A safety copy that cannot be kept throws, and nothing goes.
 */
export async function deleteEventCopyFlow(
  view: Pick<SharedEventView, 'name' | 'myName'>,
  steps: {
    plan: () => Promise<Pick<EventCopyPlan, 'refusal' | 'unsentHere'>>;
    confirm: (text: string) => boolean;
    safetyCopy: () => Promise<void>;
    remove: () => Promise<unknown>;
  },
): Promise<'deleted' | 'cancelled'> {
  const plan = await steps.plan();
  if (plan.refusal) throw new Error(plan.refusal);
  if (!steps.confirm(deleteCopyConfirm(view, plan))) return 'cancelled';
  await steps.safetyCopy();
  await steps.remove();
  return 'deleted';
}

/** A receipt's line for a transaction whose event copy was deleted here: there is no event left to open or change it on. */
export function deletedCopyLine(eventName: string | null): string {
  return `From ${eventName ?? 'a shared event'}, copy deleted here`;
}
