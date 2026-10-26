import { addCard, archiveCard, type CardRow, updateCard } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import type { Run } from './card-page';

/**
 * One piece of plastic on a card's account, as a sheet: its last four digits and whose card it is, saved from the
 * sheet's own row. With a `piece` it edits that card and offers to remove it; without, it adds one. A mistake
 * (digits already recorded at the bank) stays in the sheet, over the page that opened it.
 */
export function PlasticSheet({ accountId, piece, first, run, onClose }: { accountId: string; piece?: CardRow; first?: boolean; run: Run; onClose: () => void }) {
  const { database, ws } = useApp();
  const [last4, setLast4] = useState(piece?.last4 ?? '');
  const [holder, setHolder] = useState(piece?.holderName ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await run(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e);
        throw e;
      }
    });
    setBusy(false);
    if (ok) onClose();
  };

  const save = () =>
    attempt(() =>
      piece ? updateCard(database, ws, { cardId: piece.id, last4, holderName: holder }) : addCard(database, ws, { accountId, last4, holderName: holder, isPrimary: Boolean(first) }),
    );

  return (
    <Sheet grouped title={piece ? 'Edit card' : 'Add a card'} onClose={onClose}>
      <ErrorBox error={error} />
      <InsetGroup>
        <TextRow label="Last 4 digits" value={last4} onChange={(e) => setLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="Last digits" />
        <TextRow label="Whose card" info="Optional. The account holder, or whoever holds the supplementary card." value={holder} onChange={(e) => setHolder(e.target.value)} placeholder="Name" />
      </InsetGroup>
      <InsetGroup>
        <InsetRow title={piece ? 'Save' : 'Add card'} action testId="plastic-save" onClick={() => void save()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
      {piece && (
        <InsetGroup>
          <InsetRow title="Remove card" destructive testId="plastic-remove" onClick={() => void attempt(() => archiveCard(database, ws, piece.id))} />
        </InsetGroup>
      )}
    </Sheet>
  );
}
