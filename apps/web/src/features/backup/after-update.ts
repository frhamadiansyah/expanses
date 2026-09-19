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
  if (update.blocked !== null) {
    return {
      kind: 'undone',
      headline: 'Your update was undone',
      body: 'Something did not add up after we updated your data, so we put it back exactly as it was before. Nothing was lost, and Expanses is running on it as it was. We will not try that update again until you ask.',
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
