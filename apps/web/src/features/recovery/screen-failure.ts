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
export interface ScreenFailureOptions {
  /**
   * Whether the app's engine has been let go of before this screen is drawn.
   *
   * It decides two of the four buttons. The boundary is reached with the worker alive and idle — nothing
   * struck, so nothing terminated it — and the SAH pool holds a sync access handle on every slot file for
   * as long as that worker lives. Restore and Start fresh both write to those files and both fail on a
   * held handle, so they are offered only once the handles are really gone. Left out, the honest answer is
   * "we do not know", and this screen does not offer what it cannot promise.
   */
  released?: boolean;
}

export function screenFailureReason(error: unknown, { released = false }: ScreenFailureOptions = {}): RecoveryReason {
  const held = !released;
  const kind = fatalKind(error);
  if (kind) return { ...fatalReason(kind, messageOf(error)), held };
  return {
    kind: 'cannot-open',
    // A log line, not a screen line: `recoveryCopy` writes what the user reads. See `fatal.ts`.
    headline: 'A screen stopped while the app was open.',
    detail: messageOf(error),
    exportable: true,
    midSession: true,
    held,
  };
}

/**
 * Letting go of the engine before the screen that replaces the app is drawn.
 *
 * The one thing the boundary does besides diagnose and render, and it is not tidiness: it is what makes
 * the screen's own buttons true. Nothing is written by it and nothing is removed — the worker is asked to
 * stop and the handles it holds go with it — so it is safe on the one path where the app has already
 * failed and the user is about to be offered a way back.
 *
 * It answers whether it really happened *by the time this screen is drawn*, because that is what the screen
 * has to know, and the answer is not always yes. A build with no worker behind it (the Node-backed tests)
 * and a terminate that throws both leave the files held; so does a release deferred behind a restore that
 * is still rewriting the live slot, which the engine waits out rather than cut in half. The three are the
 * same answer to the screen: say the handles may still be there, and let `actionsFor` withhold the two
 * buttons that would fail on them. Never a thrown error of its own — the app has already crashed once, and
 * a boundary that crashes while handling a crash is the white page all over again.
 */
export function releaseEngine(release: ((letGo: () => void) => void) | undefined, onFailure: (error: unknown) => void): boolean {
  if (!release) return false;
  try {
    // Set from inside the call on every ordinary path. Still false afterwards means the engine has not let
    // go yet, and this screen does not offer what it cannot promise.
    let letGo = false;
    release(() => {
      letGo = true;
    });
    return letGo;
  } catch (error) {
    onFailure(error);
    return false;
  }
}
