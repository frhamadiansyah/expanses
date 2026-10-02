import { Capacitor, registerPlugin } from '@capacitor/core';
import type { IdxSummary } from '@expanses/core';
import { IDX_SUMMARY_PAGE, readIdxBase64 } from './idx-file';

/** What the iOS sheet hands back once Unduh's download is caught. */
export interface CaughtIdxFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

/**
 * The app's own Swift plugin (ios/App/App/IdxDownloadPlugin.swift): IDX's page in a full-screen sheet, and the file
 * its Unduh button downloads. It requests nothing itself — the owner opens the page and taps Unduh.
 */
export interface IdxDownloadPlugin {
  open(options: { url: string }): Promise<CaughtIdxFile>;
}

export const IdxDownload = registerPlugin<IdxDownloadPlugin>('IdxDownload');

/** The sheet opens only in the iOS app; the web and the desktop keep downloading and choosing the file. */
export const catchesIdxInApp = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

/** Cancel on the sheet: not an error, nothing to say. */
export const isCancelled = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 'cancelled';

/**
 * Opens IDX's page in the sheet and reads what Unduh downloads. `null` when the sheet was cancelled; anything the
 * parser refuses throws as a chosen file's would.
 */
export async function catchIdxSummary(plugin: IdxDownloadPlugin = IdxDownload): Promise<IdxSummary | null> {
  let caught: CaughtIdxFile;
  try {
    caught = await plugin.open({ url: IDX_SUMMARY_PAGE });
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
  return readIdxBase64(caught.base64);
}
