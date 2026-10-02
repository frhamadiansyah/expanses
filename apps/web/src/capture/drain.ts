/**
 * The phone's holding area into the queue, and when that happens.
 *
 * The shortcuts and the share sheet cannot reach the app's database while the app is closed; they leave captures in
 * the App Group instead. Draining is the app's side of that promise: everything waiting is read, read again by the
 * reader with whatever each source has learned, matched against what is already in the queue, and written down.
 * Nothing here is a decision to record — the drafts that come out still wait for the owner.
 *
 * The drain runs when the app opens and every time it becomes active again, because that is exactly when a phone
 * full of accumulated captures arrives. It is cheap when there is nothing: one bridge call that reads a folder, and
 * the leftover sweep (a few indexed queries) that lets go of what has passed its week.
 */
import { isoDate, type RawCapture } from '@expanses/core';
import {
  type Database,
  type IngestResult,
  ingestCaptures,
  purgeCaptureLeftovers,
  type WorkspaceContext,
} from '@expanses/db';
import { App as Shell } from '@capacitor/app';
import { native } from './native';

/** What the drain needs from the capture bridge: the phone, or a stand-in in a test. */
export interface CaptureBridge {
  /** Reads the holding area without emptying it. */
  drainCaptures(): Promise<{ captures: RawCapture[] }>;
  /** Lets the holding area drop captures the queue has stored. */
  ackCaptures(opts: { ids: string[] }): Promise<void>;
  scanReceipt(): Promise<{ capture: RawCapture | null }>;
  deleteCaptureImage(opts: { file: string }): Promise<void>;
}

/** Today, as the queue's dates read: the owner's own calendar day, not UTC's. */
const today = () => isoDate();

const nothing = (): IngestResult => ({ drafts: 0, merged: 0, skipped: 0, discardedImages: [] });

/**
 * Pictures nothing keeps any more go from the phone, and so does whatever capture leaves behind past its week (skipped
 * captures, resolved drafts' pictures and words). Best effort: the write they belong to has already committed, and
 * the sweep runs again on the next drain.
 */
async function tidyImages(
  database: Database,
  bridge: CaptureBridge,
  discarded: readonly string[],
  on: string,
): Promise<void> {
  const drop = (file: string) => bridge.deleteCaptureImage({ file }).catch(() => undefined);
  await Promise.all(discarded.map(drop));
  try {
    const { images } = await purgeCaptureLeftovers(database, on);
    await Promise.all(images.map(drop));
  } catch {
    // The sweep runs again on the next drain.
  }
}

/**
 * Empties the holding area into the queue once.
 *
 * The phone hands the captures over and keeps them; they are acknowledged only after `ingestCaptures` has
 * committed. A drain that fails or is cut short (the app killed mid-way) therefore loses nothing: the same captures
 * come back next time, and the queue takes each capture id once.
 */
export async function drainCaptures(
  database: Database,
  ws: WorkspaceContext,
  bridge: CaptureBridge = native,
  on = today(),
): Promise<IngestResult> {
  const { captures } = await bridge.drainCaptures();
  if (captures.length === 0) {
    await tidyImages(database, bridge, [], on);
    return nothing();
  }
  const result = await ingestCaptures(database, ws, captures, { today: on });
  // Stored: what is left is housekeeping. An ack that fails is retried by the next drain (the queue takes each
  // capture once), so it must not hide this drain's drafts from the screen.
  await bridge.ackCaptures({ ids: captures.map((capture) => capture.id) }).catch(() => undefined);
  await tidyImages(database, bridge, result.discardedImages, on);
  return result;
}

/**
 * One receipt, photographed now: the camera reads it on the phone, and it joins the queue the way any other
 * capture arrives — as a draft to check, never as a recorded purchase. It never passes through the holding area, so
 * there is nothing to acknowledge; its picture goes if the queue does not keep it.
 */
export async function scanReceipt(
  database: Database,
  ws: WorkspaceContext,
  bridge: CaptureBridge = native,
  on = today(),
): Promise<IngestResult> {
  const { capture } = await bridge.scanReceipt();
  if (!capture) return nothing();
  const result = await ingestCaptures(database, ws, [capture], { today: on });
  await tidyImages(database, bridge, result.discardedImages, on);
  return result;
}

/**
 * One drain at a time, across the app: opening the app and becoming active fire together, and a workspace switch
 * starts a new watcher while the old one may still be draining. Two drains of the one holding area would race each
 * other's acknowledgements and picture clean-up.
 */
let running: Promise<void> | null = null;

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
  const drainOnce = async () => {
    try {
      const result = await drainCaptures(database, ws, bridge);
      if (!stopped && (result.drafts > 0 || result.merged > 0)) onCaptured(result);
    } catch {
      // A drain that fails before its write commits is never acknowledged, so the captures stay in the holding area
      // and the next activation reads them again. There is nothing to tell the owner here — a capture is not
      // something they asked for this instant.
    }
  };
  const run = async () => {
    while (running) await running;
    running = drainOnce().finally(() => {
      running = null;
    });
    await running;
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
