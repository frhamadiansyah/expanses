import type { CreatedInvite, MoveRefusal } from '@expanses/db';

/** How far sharing one event has got, kept by the sheet across taps and retries. */
export interface ShareProgress {
  /** Set once the event has become a shared one. */
  bookId: string | null;
  /** Set once what was tagged to it has moved in. */
  kept: MoveRefusal[] | null;
  running: boolean;
}

export const freshShare = (): ShareProgress => ({ bookId: null, kept: null, running: false });

/**
 * Shares an existing event (shared events §6) with each step at most once. Sharing makes a relay book and moving
 * replaces the tagged purchases, so a second run of either would make a second book or move things twice: a double tap
 * returns null while a run is under way, and a run that failed after the book was made carries on from there instead
 * of starting over. A step that threw is the one retried.
 */
export async function runShare(
  progress: ShareProgress,
  steps: { share(): Promise<string>; convert(): Promise<MoveRefusal[]>; invite(bookId: string): Promise<CreatedInvite> },
): Promise<{ invite: CreatedInvite; kept: MoveRefusal[] } | null> {
  if (progress.running) return null;
  progress.running = true;
  try {
    progress.bookId ??= await steps.share();
    progress.kept ??= await steps.convert();
    return { invite: await steps.invite(progress.bookId), kept: progress.kept };
  } finally {
    progress.running = false;
  }
}
