/**
 * The phone's capture services, as the web layer calls them.
 *
 * On the iPhone the Capture plugin (Swift, in `ios/App/App/Capture`) recognises text with Vision, opens the camera
 * for a paper receipt, and keeps the holding area that the shortcuts and the share sheet write to. In a browser
 * none of that exists — nothing ever arrives, and the calls that only make sense on a phone say so instead of
 * pretending something happened.
 */
import type { RawCapture } from '@expanses/core';
import { registerPlugin, WebPlugin } from '@capacitor/core';

export interface CapturePluginApi {
  /** Reads the holding area, handing back every capture found there, and empties it. */
  drainCaptures(): Promise<{ captures: RawCapture[] }>;
  /** The camera, for a paper receipt; null when it was closed without one. */
  scanReceipt(): Promise<{ capture: RawCapture | null }>;
  /** The bytes of a capture's picture, base64 with its mime type. */
  readCaptureImage(opts: { file: string }): Promise<{ base64: string; mime: string }>;
  /** Drops a capture's picture from the app's private storage. */
  deleteCaptureImage(opts: { file: string }): Promise<void>;
  /** How much is still waiting in the holding area, and how much of it could not be opened. */
  holdingAreaStatus(): Promise<{ pending: number; broken: number }>;
}

class CaptureWeb extends WebPlugin implements CapturePluginApi {
  async drainCaptures(): Promise<{ captures: RawCapture[] }> {
    return { captures: [] };
  }

  async scanReceipt(): Promise<{ capture: RawCapture | null }> {
    throw new Error('Not available here');
  }

  async readCaptureImage(): Promise<{ base64: string; mime: string }> {
    throw new Error('Not available here');
  }

  async deleteCaptureImage(): Promise<void> {
    // There is no picture here to delete.
  }

  async holdingAreaStatus(): Promise<{ pending: number; broken: number }> {
    return { pending: 0, broken: 0 };
  }
}

export const native = registerPlugin<CapturePluginApi>('Capture', {
  web: () => Promise.resolve(new CaptureWeb()),
});
