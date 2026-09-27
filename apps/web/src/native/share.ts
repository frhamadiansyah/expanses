import { Share } from '@capacitor/share';
import { isNative } from '../lib/pwa';

/**
 * Hands a line of text to whatever this device shares with: the iOS share sheet inside the shell (the same
 * `@capacitor/share` the backup goes out through), the browser's own share sheet where it has one, and the clipboard
 * everywhere else. Says which it did, so the screen can say "Copied" when nothing visible happened.
 */
export async function shareText(input: { title: string; text: string }): Promise<'shared' | 'copied' | 'cancelled'> {
  try {
    if (isNative()) {
      await Share.share({ title: input.title, text: input.text, dialogTitle: input.title });
      return 'shared';
    }
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: input.title, text: input.text });
      return 'shared';
    }
  } catch (error) {
    // Closing the sheet without choosing anything is not a failure.
    if (error instanceof Error && /cancel|abort/i.test(`${error.name} ${error.message}`)) return 'cancelled';
    throw error;
  }
  await navigator.clipboard.writeText(input.text);
  return 'copied';
}
