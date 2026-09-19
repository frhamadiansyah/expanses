import type { UpdateOutcome } from '../../db/bootstrap';

/** What the card above the page says, or nothing at all. Never more than one of them at a time. */
export interface AfterUpdateNote {
  /** `updated`: the schema moved and the backup they hold is now old. `undone`: an update was put back. */
  kind: 'updated' | 'undone';
  headline: string;
  body: string;
  /** The version reached, or the one being skipped. Shown under "Details", never in the headline. */
  version: number;
}

/**
 * Whether there is anything to say after an open, and what.
 *
 * Two rules keep this quiet. A device that had no data before has not been *updated* — a first run is not
 * something to reassure anyone about — so `from` must be past zero. And a skipped update outranks an applied
 * one: being deliberately behind is the thing the user has to be told, and told only once per screen.
 *
 * The wording matches the recovery screen's, because the two are the same event seen from either side: that
 * screen says the update was undone as it happens, this says the app is running on the data it put back.
 */
export function afterUpdate(update: UpdateOutcome | undefined): AfterUpdateNote | null {
  if (!update) return null;
  /*
   * A block on its own is not an undone update. The block is a note in the manifest that outlives the open
   * that wrote it, and a device can hold one while its data is already past it — a rollback that could not
   * put the bytes back, or a backup restored over the top. Saying "your update was undone" there would be
   * a permanent, untrue sentence about data that is fine. So the file itself has to be behind the block.
   */
  if (update.blocked !== null && update.from < update.blocked) {
    return {
      kind: 'undone',
      headline: 'Your update was undone',
      /*
       * What the app knows here is that an update did not come out right and was put back — not which of
       * the checks said so, and not, after a run of several, which migration was at fault. The words stay
       * inside that: no claim about the culprit, and no claim about which check failed.
       */
      body: 'An update to your data did not come out the way we expect, so we put it back exactly as it was before it started. Nothing was lost, and Expanses is running on your data as it was. We will not try that update again until you ask.',
      version: update.blocked,
    };
  }
  if (update.from > 0 && update.applied.length > 0) {
    const version = Math.max(...update.applied);
    return {
      kind: 'updated',
      headline: `Your data was updated to version ${version}`,
      body: 'A copy was taken before the update and it was checked afterwards. A backup you keep yourself is still the only one off this device — download one now?',
      version,
    };
  }
  return null;
}

/**
 * Whether the standing backup reminder should stand down for the card above the page.
 *
 * Only while that card is actually on screen. The card says more about the user's data than the banner
 * can and offers the same backup, so two of them at once is the nagging this branch exists to avoid —
 * but a card the user has put away is not on screen, and the reminder it was covering for is a promise
 * about the only copy of their money. It comes straight back.
 */
export function bannerStandsDown(note: AfterUpdateNote | null, dismissed: boolean): boolean {
  return note !== null && !dismissed;
}
