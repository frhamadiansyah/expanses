import { bringBack, type SkippedRow } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { useSkippedCaptures } from './queries';

/** What a skipped capture was, in a few words: its title, its first line, or failing both, its own words. */
function wasAbout(row: SkippedRow): string {
  return (
    row.capture.title?.trim() ||
    row.capture.lines[0]?.text.trim() ||
    row.capture.body?.trim().slice(0, 80) ||
    'A capture'
  );
}

/**
 * The foot of the queue: what was not made into a draft, and the way back.
 *
 * A capture is skipped for one of two of the owner's own reasons — it looked like an offer, or only money going out
 * was wanted at the time — and neither is a decision to throw it away. Bringing one back is the owner overruling
 * both filters for that one capture: it becomes the draft it would have been, and leaves this list.
 */
export function SkippedList() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const skipped = useSkippedCaptures();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const rows = skipped.data ?? [];

  if (rows.length === 0) return null;

  async function recover(row: SkippedRow) {
    setError(null);
    setBusy(row.id);
    try {
      await bringBack(database, ws, row.id);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ErrorBox error={error ?? skipped.error} />
      <InsetGroup
        header={`Skipped (${rows.length})`}
        footer="Offers, and what arrived while only money going out was wanted. Kept for a week."
      >
        {rows.map((row) => (
          <InsetRow
            key={row.id}
            title={wasAbout(row)}
            subtitle={row.reason === 'promo' ? 'Looked like an offer' : 'Skipped by Expenses only'}
            value={<span className="text-[13px] font-semibold text-[var(--ph-tint)]">Bring back</span>}
            disabled={busy !== null}
            testId="skipped-row"
            onClick={() => void recover(row)}
          />
        ))}
      </InsetGroup>
    </>
  );
}
