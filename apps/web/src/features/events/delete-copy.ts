import type { SharedEventView } from '@expanses/db';

/*
 * Delete this copy (owner report 2026-11-12): the read-only copy of a shared event this phone's person is no longer in
 * comes off this phone alone (`deleteEventCopy`). The words name the person and never say "you" (the owner's rule).
 */

export const DELETE_COPY_LABEL = 'Delete this copy';

/** The one confirm before the copy goes. */
export function deleteCopyConfirm(view: Pick<SharedEventView, 'name' | 'myName'>): string {
  return `Delete this copy of ${view.name}? ${view.myName} is no longer in it. What was recorded stays with the others.`;
}

/**
 * The delete, in its order: the safety copy first (`useSafetyCopy('before-delete')`, kept as a workspace's Delete
 * keeps it), then the copy goes. A safety copy that cannot be kept throws, and nothing is deleted.
 */
export async function deleteEventCopyFlow(steps: { safetyCopy: () => Promise<void>; remove: () => Promise<unknown> }): Promise<void> {
  await steps.safetyCopy();
  await steps.remove();
}
