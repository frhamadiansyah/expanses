import { isoDate, type RawCapture } from '@expanses/core';
import { type Database, ingestCaptures, type WorkspaceContext } from '@expanses/db';

/**
 * The e2e build's way in: captures injected exactly where a drained one would land.
 *
 * The phone's own doors — Shortcuts, Back Tap, the camera — cannot run in a browser, so a Playwright journey needs
 * another way to hand the queue a capture. This is the same `ingestCaptures` the drain calls, on the same database:
 * everything the journey then sees (sources, matching, drafts) is the real pipeline, not a mock of it. `images`
 * stands in for the phone's private capture folder, so a picture's bytes can be read back and the viewer has
 * something to draw its boxes over.
 *
 * Installed only when the build says so (`VITE_E2E=1`, set by the Playwright config alone), so a shipped app has
 * no such function on its window at all.
 */
export function installCaptureTestHook(opts: {
  database: Database;
  ws: WorkspaceContext;
  /** Called after a successful inject, so the screen re-reads its queries. */
  onCaptured: () => void;
}): void {
  if (import.meta.env.VITE_E2E !== '1') return;
  window.__captureInject = async (captures, images = {}) => {
    Object.assign((window.__captureImages ??= {}), images);
    const result = await ingestCaptures(opts.database, opts.ws, captures, { today: isoDate() });
    opts.onCaptured();
    return result;
  };
}

declare global {
  interface Window {
    /** Injects captures into the drain's own pipeline. E2E builds only. */
    __captureInject?: (
      captures: RawCapture[],
      images?: Record<string, { base64: string; mime: string }>,
    ) => Promise<{ drafts: number; merged: number; skipped: number }>;
    /** Picture bytes the injected captures' `imageFile` names resolve to. E2E builds only. */
    __captureImages?: Record<string, { base64: string; mime: string }>;
  }
}
