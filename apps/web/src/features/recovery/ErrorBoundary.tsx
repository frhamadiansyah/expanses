import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { SnapshotStore } from '../../db/open';
import { RecoveryScreen } from './RecoveryScreen';
import { screenFailureReason } from './screen-failure';

interface Props {
  snapshots: SnapshotStore;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
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
  override state: State = { failed: false, error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // The one place this is recorded. The user gets the reason's `detail` under "Details"; a developer
    // gets the component that threw, which the reason has no honest way to carry.
    console.error('A screen stopped before it could finish', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <RecoveryScreen reason={screenFailureReason(this.state.error)} snapshots={this.props.snapshots} />;
  }
}
