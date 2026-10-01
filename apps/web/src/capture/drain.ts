/**
 * The phone's holding area into the queue, and when that happens.
 *
 * The shortcuts and the share sheet cannot reach the app's database while the app is closed; they leave captures in
 * the App Group instead. Draining is the app's side of that promise: everything waiting is read, read again by the
 * reader with whatever each source has learned, matched against what is already in the queue, and written down.
 * Nothing here is a decision to record — the drafts that come out still wait for the owner.
 *
 * The drain runs when the app opens and every time it becomes active again, because that is exactly when a phone
 * full of accumulated captures arrives. It is cheap when there is nothing: one bridge call that reads a folder.
 */
import type { RawCapture } from '@expanses/core';
import { type Database, type IngestResult, ingestCaptures, type WorkspaceContext } from '@expanses/db';
import { App as Shell } from '@capacitor/app';
import { native } from './native';

/** What the drain needs from the capture bridge: the phone, or a stand-in in a test. */
export interface CaptureBridge {
  drainCaptures(): Promise<{ captures: RawCapture[] }>;
  scanReceipt(): Promise<{ capture: RawCapture | null }>;
}

/** Today, as the queue's dates read: the day the phone noticed the capture. */
const today = () => new Date().toISOString().slice(0, 10);

/** Empties the holding area into the queue once. */
export async function drainCaptures(
  database: Database,
  ws: WorkspaceContext,
  bridge: CaptureBridge = native,
  on = today(),
): Promise<IngestResult> {
  const { captures } = await bridge.drainCaptures();
  if (captures.length === 0) return { drafts: 0, merged: 0, skipped: 0 };
  return ingestCaptures(database, ws, captures, { today: on });
}

/**
 * One receipt, photographed now: the camera reads it on the phone, and it joins the queue the way any other
 * capture arrives — as a draft to check, never as a recorded purchase.
 */
export async function scanReceipt(
  database: Database,
  ws: WorkspaceContext,
  bridge: CaptureBridge = native,
  on = today(),
): Promise<IngestResult> {
  const { capture } = await bridge.scanReceipt();
  if (!capture) return { drafts: 0, merged: 0, skipped: 0 };
  return ingestCaptures(database, ws, [capture], { today: on });
}

/**
 * Drains now, and on every return to the foreground. `onCaptured` is told when something came of it, so the app
 * can refresh the queue; a drain that found nothing — the common case — touches nothing. Returns the way to stop.
 */
export function watchCaptures(
  database: Database,
  ws: WorkspaceContext,
  onCaptured: (result: IngestResult) => void,
  bridge: CaptureBridge = native,
): () => void {
  let stopped = false;
  const run = async () => {
    try {
      const result = await drainCaptures(database, ws, bridge);
      if (!stopped && (result.drafts > 0 || result.merged > 0)) onCaptured(result);
    } catch {
      // A drain that fails leaves the captures in the holding area: the next activation tries again. There is
      // nothing to tell the owner here — a capture is not something they asked for this instant.
    }
  };
  void run();
  const listener = Shell.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void run();
  });
  return () => {
    stopped = true;
    void listener.then((handle) => handle.remove());
  };
}
