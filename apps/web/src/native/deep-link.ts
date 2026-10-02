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

/** Whether a link is `cicis://review`, the address the share sheet opens the app with once a picture is stored. */
export function isReviewLink(url: string): boolean {
  return /^cicis:\/\/review\/?$/i.test(url.trim());
}

/**
 * In the shell, opens Review for every `cicis://review` link — the share sheet's way of taking the owner to the
 * draft it has just left. The drain runs as the app becomes active, so the draft is there to see. Returns the way to
 * stop listening. Does nothing in a browser.
 */
export function listenForReviewLinks(open: () => void): () => void {
  if (!isNative()) return () => {};
  let stopped = false;
  const handle = Shell.addListener('appUrlOpen', ({ url }) => {
    if (isReviewLink(url)) open();
  });
  void Shell.getLaunchUrl()
    .then((launch) => {
      if (launch?.url && isReviewLink(launch.url) && !stopped) open();
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    void handle.then((h) => h.remove());
  };
}
