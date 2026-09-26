import { isNative } from './pwa';

/** Where the bytes actually went, which is the only honest basis for what the screen says next. */
export type SavedTo = 'downloads' | 'share-sheet';

/**
 * Hands a file to the person, by whichever route this build has.
 *
 * In a browser that is a download. **In the native app it is the share sheet**, because a blob `<a download>`
 * does nothing at all in Capacitor's WKWebView — it implements no `WKDownloadDelegate`, so the click is
 * swallowed and no file appears anywhere. Every caller of this function is a way for a person to get their own
 * data off the device, the recovery screen included, so the native app without this is an app whose only copy
 * of your money cannot be taken out of it.
 *
 * The native plugins are imported only on the branch that needs them: loading Filesystem and Share in a browser
 * would put two plugins nobody calls into the web bundle, which has a budget.
 *
 * It resolves with the route taken so the screen can say the true thing — "check your Downloads" is wrong
 * advice on a phone — and rejects if the file could not be handed over at all.
 */
export async function saveBytes(bytes: Uint8Array, filename: string, type = 'application/octet-stream'): Promise<SavedTo> {
  if (isNative()) {
    const { shareBackup } = await import('../native/backup');
    await shareBackup(bytes, filename);
    return 'share-sheet';
  }
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloads';
}

/**
 * What to tell someone about a file that has just left the app, in the words of the route it took.
 *
 * Kept beside `saveBytes` rather than written out at each of its callers: the wording turns on the same fact
 * the function already returns, and four screens each guessing at it is how "check your Downloads" came to be
 * shown on a phone that has no Downloads folder to check.
 */
export function savedWhere(to: SavedTo): string {
  return to === 'share-sheet' ? 'Keep it somewhere private — in Files, or sent to yourself.' : 'Check it is in your Downloads and keep it somewhere private.';
}
