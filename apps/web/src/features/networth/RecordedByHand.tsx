import { undoRecordedByHand } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { handEventLabel } from './deposit-proposal';
import { useUndoableByHand } from './queries';

/**
 * "Undo recorded by hand": each hand-recorded event of this deposit that nothing later blocks, one kit row each.
 * Undoing takes the event off the log and proposes it again; nothing is posted or voided, because recording it by
 * hand posted nothing. The owner's own transactions stay as they are.
 */
export function RecordedByHand({ accountId, currency }: { accountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const events = useUndoableByHand(accountId);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rows = events.data ?? [];
  if (rows.length === 0 && !error) return null;

  async function undo(eventId: string) {
    setError(null);
    setBusy(true);
    try {
      await undoRecordedByHand(database, ws, eventId);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="recorded-by-hand">
      <InsetGroup
        header="Recorded by hand"
        footer="Undo puts it back as a proposal. Nothing is posted or deleted: what you recorded yourself stays in your transactions."
      >
        {rows.map((event) => (
          <InsetRow
            key={event.id}
            title="Undo recorded by hand"
            subtitle={handEventLabel(event, currency)}
            chevron={false}
            disabled={busy}
            onClick={() => void undo(event.id)}
          />
        ))}
      </InsetGroup>
      <ErrorBox error={error} />
    </div>
  );
}
