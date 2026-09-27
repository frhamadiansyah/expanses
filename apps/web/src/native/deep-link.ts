import { App as Shell } from '@capacitor/app';
import { JOIN_LINK_PREFIX } from '@expanses/db';
import { isNative } from '../lib/pwa';

/**
 * The invite code a `cicis://join/<code>` link carries (household sharing spec §8.1), or null for any other address.
 * iOS may hand the link over as `cicis://join/CODE` or with the code after a slash more, so both are read.
 */
export function joinCodeOf(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith(JOIN_LINK_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed.slice(JOIN_LINK_PREFIX.length));
  } catch {
    return null;
  }
  const code = decoded.replace(/^\/+|\/+$/g, '');
  return code || null;
}

/**
 * In the shell, opens Join a workspace for every `cicis://join/…` link the system hands the app — the one it was
 * launched by, and each one after while it runs. Returns the way to stop listening. Does nothing in a browser, where
 * the same link is the ordinary address `/join/<code>`.
 */
export function listenForJoinLinks(open: (code: string) => void): () => void {
  if (!isNative()) return () => {};
  let stopped = false;
  const handle = Shell.addListener('appUrlOpen', ({ url }) => {
    const code = joinCodeOf(url);
    if (code) open(code);
  });
  void Shell.getLaunchUrl()
    .then((launch) => {
      const code = launch?.url ? joinCodeOf(launch.url) : null;
      if (code && !stopped) open(code);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    void handle.then((h) => h.remove());
  };
}
