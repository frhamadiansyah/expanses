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

/** The steps that bring an event's own things into its shared event, read and run against this phone's db. */
export interface ConversionSteps {
  /** Items already on the shared plan. */
  sharedItemCount(): Promise<number>;
  /** Transactions the event's records already put in this phone's books: moved purchases among them. */
  derivedIds(): Promise<ReadonlySet<string>>;
  /** Transactions tagged to the event and still in a workspace. */
  tagged(): Promise<string[]>;
  /** The whole conversion: categories from the set, the moves, the plan. */
  convert(): Promise<MoveRefusal[]>;
  /** The moves alone. */
  move(transactionIds: string[]): Promise<MoveRefusal[]>;
}

/**
 * Brings an event's own things into its shared event, safe to run again (I9). Sharing ran `convertEventToShared` once,
 * right after the relay book was made; when that was cut short — a missing rate, the app closed — the page offers to
 * finish it, and a retry inside the sheet lands here too.
 *
 * The plan is copied only while the shared plan is empty: copying it twice would put every item on it twice (C16),
 * and an item already there means the copy ran (it is the conversion's last step). Once it has, what is left is the
 * moves, of the purchases still in a workspace. Purchases already moved are this event's own transactions, so the
 * refusals for them ("Already in a shared event") are not news and are left out.
 */
export async function finishConversion(steps: ConversionSteps): Promise<MoveRefusal[]> {
  const derived = await steps.derivedIds();
  const kept = (await steps.sharedItemCount()) === 0 ? await steps.convert() : await steps.move((await steps.tagged()).filter((id) => !derived.has(id)));
  return kept.filter((k) => !derived.has(k.transactionId));
}

/** What is still to bring in, as the page reads it. */
export interface ConversionLeft {
  /** Tagged purchases still in a workspace. */
  remaining: number;
  /** Items on the event's own (local) plan, and on the shared one. */
  localItems: number;
  sharedItems: number;
  /** The event draws on a set and the shared event has no categories yet. */
  setWithoutCategories: boolean;
}

/**
 * Whether the page offers "Finish sharing": a conversion not marked done on this phone that left something behind.
 * What cannot move (a transfer, a refund, a split) stays tagged for good, so after one finished run the mark keeps the
 * offer from coming back for it.
 */
export function needsFinishing(left: ConversionLeft, converted: boolean): boolean {
  if (converted) return false;
  return left.remaining > 0 || (left.localItems > 0 && left.sharedItems === 0) || left.setWithoutCategories;
}

const CONVERTED_KEY = 'cicis.events.converted';

/** The events whose conversion finished on this phone. A convenience only: lost, the page offers a harmless re-run. */
export function conversionDone(eventId: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(CONVERTED_KEY) ?? '[]') as string[]).includes(eventId);
  } catch {
    return false;
  }
}

export function markConversionDone(eventId: string): void {
  try {
    const done = JSON.parse(localStorage.getItem(CONVERTED_KEY) ?? '[]') as string[];
    if (!done.includes(eventId)) localStorage.setItem(CONVERTED_KEY, JSON.stringify([...done, eventId]));
  } catch {
    // Remembered only as a convenience.
  }
}
