import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../app/context';
import { useInvalidateAll } from '../lib/queries';
import { pickPhotos, scanReceipt } from './drain';

/** Where the pictures come from: the camera, now, or the photo library, for pictures already taken. */
export type ScanSource = 'camera' | 'photos';

/**
 * The camera and the photo library, from any screen that offers them: a receipt photographed or a picture chosen,
 * and the capture becomes a draft.
 *
 * The work itself is `scanReceipt`'s and `pickPhotos`'s — the phone reads the pictures and the queue swallows them
 * whole — and what this wraps around it is the screen's part: a busy state, an error to show, and the walk onwards.
 * A draft goes to the queue, where the owner is told what the figure turned out to be; a statement's screenshots go
 * to the card picker, as the share sheet sends them. A pick that was cancelled (or read nothing a draft could be
 * made from) goes nowhere and says nothing.
 */
export function useScanReceipt() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function scan(source: ScanSource = 'camera') {
    setError(null);
    setBusy(true);
    try {
      if (source === 'photos') {
        const { result, statement } = await pickPhotos(database, ws);
        if (statement) {
          void navigate({ to: '/statement/shared', search: { batch: statement } });
          return;
        }
        await invalidate();
        if (result.drafts > 0 || result.merged > 0) void navigate({ to: '/review' });
        return;
      }
      const result = await scanReceipt(database, ws);
      await invalidate();
      if (result.drafts > 0 || result.merged > 0) void navigate({ to: '/review' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return { scan, busy, error };
}
