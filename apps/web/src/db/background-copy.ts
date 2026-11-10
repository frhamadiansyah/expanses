import { App as Shell } from '@capacitor/app';
import type { Safety } from './open';

/**
 * The copy taken when the app leaves the foreground.
 *
 * The day's copy and the copy before an update leave up to a day of entries with no copy at all, and a phone
 * app is left — swiped away, locked, switched from — many times a day. So each time it goes to the background,
 * if anything was written since the last such copy and none was taken in the last ten minutes, one more copy
 * is taken, of a file that has just passed `quick_check`. Only the newest is kept, and it never takes the place
 * of a daily or before-update copy (`keepTwo` in `snapshot-policy.ts`).
 *
 * It must be quick and harmless if iOS suspends or kills the app part way. A suspended write simply finishes
 * when the app comes back; a killed one leaves a file that `looksWhole` refuses to list (empty, or shorter
 * than its own header says), and the next copy that verifies removes it. The manifest is never touched for a
 * background copy, so there is nothing in it to tear.
 */

/** At most one background copy in this long, counted from the last attempt that found something to copy. */
export const BACKGROUND_COPY_EVERY_MS = 10 * 60 * 1000;

export type BackgroundOutcome = 'taken' | 'unchanged' | 'too-soon' | 'in-flight' | 'failed';

/**
 * One attempt per call, under three rules: never two at once, nothing when the engine's change count is where
 * it was at the last copy, and nothing within `BACKGROUND_COPY_EVERY_MS` of the last attempt that found a
 * change. That last clock is started by a copy that failed, too — a file that did not pass `quick_check` is not
 * checked again on every leave — while "nothing changed" costs one cheap query and starts nothing.
 *
 * The count starts at 0, the connection's own count when it opened: whatever the open and the first moments of
 * the session wrote (an update, captures drained into drafts) is a change worth a copy. Compared for equality,
 * because a restore or a wipe reopens the connection and starts the count again.
 *
 * Every failure is a warning and an outcome, never a throw: this runs as the app is put away, with nobody
 * looking, and a copy that could not be taken must not cost anyone the session.
 */
export function backgroundCopier(
  safety: Safety & Required<Pick<Safety, 'checked'>>,
  now: () => number = () => Date.now(),
): () => Promise<BackgroundOutcome> {
  let since = 0;
  let lastTried: number | null = null;
  let inFlight: Promise<BackgroundOutcome> | null = null;

  const attempt = async (): Promise<BackgroundOutcome> => {
    // Either way round: a clock moved back must not hold the next copy off until it catches up.
    if (lastTried !== null && Math.abs(now() - lastTried) < BACKGROUND_COPY_EVERY_MS) return 'too-soon';
    try {
      const found = await safety.checked(since);
      if (!found.bytes) return 'unchanged';
      lastTried = now();
      await safety.snapshots.write(found.bytes, 'background', safety.schemaVersion);
      since = found.changes;
      return 'taken';
    } catch (error) {
      lastTried = now();
      console.warn('The copy on leaving the app could not be taken', error);
      return 'failed';
    }
  };

  return () => {
    if (inFlight) return Promise.resolve('in-flight');
    inFlight = attempt().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

const copiers = new WeakMap<Safety, () => Promise<BackgroundOutcome>>();

/**
 * The one copier for this open's `Safety`, so a remount (React's StrictMode mounts twice) keeps its count and
 * clock. Null where there is no worker to ask for a checked copy.
 */
export function backgroundCopyFor(safety: Safety): (() => Promise<BackgroundOutcome>) | null {
  const { checked } = safety;
  if (!checked) return null;
  let copier = copiers.get(safety);
  if (!copier) {
    copier = backgroundCopier({ ...safety, checked });
    copiers.set(safety, copier);
  }
  return copier;
}

/** Where the signals come from. The real ones by default; the unit tests hand in their own. */
export interface LeaveSignals {
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;
  shell?: { addListener(event: 'pause' | 'resume', listener: () => void): Promise<{ remove(): Promise<void> }> };
}

const realSignals = (): LeaveSignals => ({ document, window, shell: Shell as LeaveSignals['shell'] });

/**
 * Calls `onLeave` once each time the app leaves the foreground, and returns the way to stop listening.
 *
 * Two signals, because neither alone is certain in a WKWebView: Capacitor's `pause` is the native
 * `didEnterBackground`, and `visibilitychange` to hidden is what WebKit itself fires when the web view's app
 * goes to the background (and what a browser fires for a tab hidden or closed). Whichever comes first counts;
 * the other is the same leave and is ignored until the app is back (`resume`, `visibilitychange` to visible or
 * `pageshow`). So one leave is one attempt.
 *
 * `pagehide` is deliberately not a leave. In a WKWebView it fires on navigation, not on going to the
 * background, and a page being unloaded is the one moment a write is certain to be cut off half way. For the
 * same reason the attempt is put off by one task: a page that is unloading fires `visibilitychange` to hidden
 * in the same task as its `pagehide`, and a timer on a page that has gone never runs — so a reload or a
 * navigation takes no copy, and a real trip to the background does. `pagehide` also cancels the timer, so a
 * page put into the back-forward cache does not take its copy on the way back out.
 */
export function watchLeaving(onLeave: () => void, signals: LeaveSignals = realSignals()): () => void {
  let away = false;
  // Capacitor's listener handles are removed asynchronously, so a signal can still arrive after `stop`.
  let stopped = false;
  let pending: number | undefined;
  const leave = () => {
    if (away || stopped) return;
    away = true;
    pending = signals.window.setTimeout(() => {
      pending = undefined;
      onLeave();
    }, 0);
  };
  const back = () => {
    away = false;
  };
  const gone = () => {
    if (pending !== undefined) signals.window.clearTimeout(pending);
    pending = undefined;
  };
  const visibility = () => (signals.document.visibilityState === 'hidden' ? leave() : back());

  signals.document.addEventListener('visibilitychange', visibility);
  signals.window.addEventListener('pageshow', back);
  signals.window.addEventListener('pagehide', gone);
  const handles = signals.shell ? [signals.shell.addListener('pause', leave), signals.shell.addListener('resume', back)] : [];

  return () => {
    stopped = true;
    gone();
    signals.document.removeEventListener('visibilitychange', visibility);
    signals.window.removeEventListener('pageshow', back);
    signals.window.removeEventListener('pagehide', gone);
    for (const handle of handles) void handle.then((h) => h.remove()).catch(() => undefined);
  };
}
