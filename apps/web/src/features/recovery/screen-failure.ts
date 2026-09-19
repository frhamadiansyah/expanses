import { fatalKind, fatalReason, messageOf } from '../../db/fatal';
import type { RecoveryReason } from '../../db/open';

/**
 * What a screen that threw while rendering is shown as.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, and an unmounted tree is a
 * white page — the one outcome this branch exists to abolish, and the one the mid-session classifier
 * quietly degrades to when it does not recognise an error's wording. So there is a boundary now, and this
 * is the decision it makes, kept out of the component so it can be read and tested as prose.
 *
 * SQLite is asked first. A screen usually throws because something it awaited rejected, and when that
 * rejection is a corrupt page or a file that has gone away, the honest screen is the one §3.4 already
 * builds: same kind, same words, same buttons, whether the engine's answer arrived through the executor or
 * through a component that could not survive it.
 *
 * Everything else is a bug in a screen, and the reason says so rather than guessing at the data: the file
 * has not been touched, the engine never complained, and `cannot-open` is the kind whose screen offers
 * every tool without claiming anything went wrong with the bytes. `midSession` is true because it is: the
 * app was open and being used a moment ago, and the user is owed that sentence.
 */
export function screenFailureReason(error: unknown): RecoveryReason {
  const kind = fatalKind(error);
  if (kind) return fatalReason(kind, messageOf(error));
  return {
    kind: 'cannot-open',
    // A log line, not a screen line: `recoveryCopy` writes what the user reads. See `fatal.ts`.
    headline: 'A screen stopped while the app was open.',
    detail: messageOf(error),
    exportable: true,
    midSession: true,
  };
}
