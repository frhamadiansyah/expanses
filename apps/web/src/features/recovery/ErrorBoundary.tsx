import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { SnapshotStore } from '../../db/open';
import { RecoveryScreen } from './RecoveryScreen';
import { releaseEngine, screenFailureReason } from './screen-failure';

interface Props {
  snapshots: SnapshotStore;
  /**
   * Lets go of the app's engine, from `AppDb.release`. Optional because a caller may have no worker to let
   * go of; without it the screen withholds the two buttons that write. See `releaseEngine`.
   */
  release?: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
  /** Whether the engine's handles on the files are really gone, decided in `componentDidCatch`. */
  released: boolean;
}

/**
 * The floor under every screen.
 *
 * React's answer to a render that throws is to unmount the whole tree, which is a white page with nothing
 * on it to press — the failure this branch exists to abolish, arrived by the one route none of the twelve
 * tasks covered. It is also where an unrecognised mid-session fatal ends up: `fatalKind` reads English
 * error text, so a build of sqlite-wasm that reworded "database disk image is malformed" would leave the
 * rejection to surface inside whichever screen was reading, and "degrades to the old behaviour" would mean
 * degrades to a blank page.
 *
 * So the tree is caught here and the same recovery screen is drawn, with a typed reason (`screen-failure.ts`
 * decides which) and the same buttons: take a copy, put back the last good one, try again. Nothing is
 * written, and nothing is thrown away — the boundary diagnoses and renders, exactly like the fatal path.
 *
 * It is the last resort and not the first: a fatal the executor *does* recognise never reaches here,
 * because `guardMount` swaps the screen before the failure can reach a render.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, error: null, released: false };

  static getDerivedStateFromError(error: unknown): Pick<State, 'failed' | 'error'> {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // The one place this is recorded. The user gets the reason's `detail` under "Details"; a developer
    // gets the component that threw, which the reason has no honest way to carry.
    console.error('A screen stopped before it could finish', error, info.componentStack);
    /*
     * And then the engine is let go of, because two of the four buttons below cannot work until it is.
     * Nothing struck on this path — the engine never complained; a screen did — so nothing terminated the
     * worker, and it is still holding a sync access handle on every slot file the SAH pool owns. Restore
     * and Start fresh both write to those files.
     *
     * Done here rather than in `getDerivedStateFromError`, which React may call more than once and asks to
     * be pure, and here rather than in `render`, which must not have side effects at all. `setState` from
     * a commit-phase lifecycle is flushed before the browser paints, so the screen is drawn once, with the
     * buttons it has earned.
     */
    this.setState({
      released: releaseEngine(this.props.release, (failure) => console.warn('The database engine could not be let go of', failure)),
    });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <RecoveryScreen reason={screenFailureReason(this.state.error, { released: this.state.released })} snapshots={this.props.snapshots} />
    );
  }
}
