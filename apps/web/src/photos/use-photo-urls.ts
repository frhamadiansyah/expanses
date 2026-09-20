import type { TransactionPhotoRow } from '@expanses/db';
import { useEffect, useState } from 'react';
import { photos } from './store';

/**
 * An object URL per picture, revoked when whatever is showing them goes away.
 *
 * The bytes never leave the device, so there is no src a browser could fetch: each picture is read out of OPFS
 * and handed to the page as a blob URL. A URL not revoked holds its blob in memory for the life of the tab,
 * which on a phone full of receipts is the difference between a screen and a crash.
 *
 * It lives here rather than in `ReceiptPage.tsx` because two screens show the same pictures — the receipt's
 * strip and the Photos sheet that puts them there — and a second copy of this hook is a second place to forget
 * the revoke.
 */
export function usePhotoUrls(rows: readonly TransactionPhotoRow[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const names = rows.map((row) => row.fileName).join(',');
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const name of names ? names.split(',') : []) {
        const url = await photos.photoUrl(name);
        if (!url) continue;
        made.push(url);
        next[name] = url;
      }
      if (live) setUrls(next);
      else for (const url of made) URL.revokeObjectURL(url);
    })();
    return () => {
      live = false;
      setUrls({});
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [names]);
  return urls;
}
