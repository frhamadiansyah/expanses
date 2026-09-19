import type { RecoveryReason } from './open';

/**
 * Whether the app may still be put on screen, once the mid-session fatal has been listened for.
 *
 * `mountable()` answers false from the instant the recovery screen has been shown, and must be asked again
 * before every paint of the app: the whole point is that it can change underneath an `await`.
 */
export interface FatalGate {
  mountable(): boolean;
}

/**
 * Listens for a failure the session cannot carry on past, and says whether the app may still be mounted.
 *
 * This exists because "render the recovery screen" and "render the app" go to the same React root, and the
 * one that runs last wins. Registering the handler and then rendering the app unconditionally — which is
 * what `main.tsx` did — is correct only while the fatal is still in the future. It is not always in the
 * future: `executor.onFatal` hands over a fatal that has *already* been recorded, synchronously, on
 * registration, and that case is reachable in production. `openAppDb` swallows a failed `syncLinkedPrograms`
 * by design (spec §5.2), so a corrupt page under the card-programs tables strikes the executor, is
 * swallowed, and the open still returns `ok`. The recovery screen was then painted and the app painted
 * straight over the top of it — the user left inside an app over a terminated worker, every query rejecting,
 * and no second chance at the swap, because a strike fires only once. That is exactly the "detected but the
 * screen never changes" failure this branch exists to prevent.
 *
 * So the decision is a value, not an ordering: nothing renders the app without asking. A fatal recorded
 * before the open finished, during it, or at any point after wins, and it wins by the same route each time.
 *
 * `register` is optional because `AppDb.onFatal` is: a database opened without a worker (the Node-backed
 * tests) has no engine that can die underneath it, and every screen stays mountable.
 */
export function guardMount(
  register: ((handler: (reason: RecoveryReason) => void) => void) | undefined,
  show: (reason: RecoveryReason) => void,
): FatalGate {
  let struck = false;
  register?.((reason) => {
    struck = true;
    show(reason);
  });
  return { mountable: () => !struck };
}
