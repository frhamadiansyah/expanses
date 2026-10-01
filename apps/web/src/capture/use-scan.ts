import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../app/context';
import { useInvalidateAll } from '../lib/queries';
import { scanReceipt } from './drain';

/**
 * The camera, from any screen that offers it: photograph a receipt, and the capture becomes a draft.
 *
 * The work itself is `scanReceipt`'s — the phone reads the picture and the queue swallows it whole — and what
 * this wraps around it is the screen's part: a busy state, an error to show, and the walk to the queue, which is
 * where the owner is told what the figure turned out to be. A scan that was cancelled (or read nothing a draft
 * could be made from) goes nowhere and says nothing.
 */
export function useScanReceipt() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function scan() {
    setError(null);
    setBusy(true);
    try {
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
