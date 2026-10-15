import { formatMinor } from '@expanses/core';
import { ownerScope, type SharedEventView, type SharedSettlementView, voidSettlement } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow } from '../../ui/native';
import { TwoTapDelete } from '../transactions/TwoTapDelete';

/**
 * One recorded settle-up, and its only correction (ruling R11): who paid whom never changes, so a wrong one is deleted
 * and recorded again. Deleting asks twice, in place, as every delete in the app does. Offered only to whoever may
 * (`settlementDeletable`); `voidSettlement` checks the same rule again.
 */
export function SettlementSheet({ view, settlement, onClose }: { view: SharedEventView; settlement: SharedSettlementView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await voidSettlement(database, ownerScope(ws), view.eventId, settlement.settlementId);
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="Settle-up" onClose={onClose}>
      <div data-testid="settlement-sheet">
        <ErrorBox error={error} />
        <InsetGroup footer="A settle-up is corrected by deleting it and recording it again.">
          <ReadOnlyRow label="Paid" value={`${settlement.fromName} paid ${settlement.toName}`} />
          <ReadOnlyRow label="Amount" value={formatMinor(settlement.amountMinor, view.currency)} />
          <ReadOnlyRow label="On" value={new Date(`${settlement.occurredOn}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
        </InsetGroup>
        <div className="mt-[12px] flex justify-center">
          <TwoTapDelete busy={busy} onConfirm={() => void remove()} />
        </div>
      </div>
    </Sheet>
  );
}
