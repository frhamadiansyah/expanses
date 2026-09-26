import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/**
 * Hands a backup to the iOS share sheet ("Save to Files", AirDrop, Mail…). A blob `<a download>` does
 * nothing in Capacitor's WKWebView — it implements no WKDownloadDelegate — so the bytes are written to
 * the app's cache directory natively and shared by file URL.
 */
export async function shareBackup(bytes: Uint8Array, filename: string): Promise<void> {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { uri } = await Filesystem.writeFile({ path: filename, data: btoa(binary), directory: Directory.Cache });
  await Share.share({ title: filename, files: [uri] });
}
