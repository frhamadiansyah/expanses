import { Directory, Filesystem } from '@capacitor/filesystem';
import { registerPlugin } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { isMacApp } from '../lib/mac';

/** The Mac's own Save window for a file the app wrote (ios/App/App/AppViewController.swift, Mac builds only). */
const FileExport = registerPlugin<{ exportFile(options: { path: string }): Promise<{ saved: boolean }> }>('FileExport');

/**
 * Hands a backup to the iOS share sheet ("Save to Files", AirDrop, Mail…). A blob `<a download>` does
 * nothing in Capacitor's WKWebView — it implements no WKDownloadDelegate — so the bytes are written to
 * the app's cache directory natively and shared by file URL.
 */
export async function shareBackup(bytes: Uint8Array, filename: string): Promise<void> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { uri } = await Filesystem.writeFile({ path: filename, data: btoa(binary), directory: Directory.Cache });
  // The Mac's share menu has no plain Save, so a backup there goes through the Save window instead (owner, 22 Nov 2026).
  if (isMacApp()) {
    await FileExport.exportFile({ path: uri });
    return;
  }
  await Share.share({ title: filename, files: [uri] });
}
