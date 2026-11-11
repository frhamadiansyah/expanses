import { heldElsewhereOf, SharingError } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { useCopyRoles } from './queries';
import { useActionRunner } from './share-hooks';
import { heldLine, PLACE_CONFIRM, PLACE_LABEL, PLACE_TITLE, placedLine } from './sharing-copy';

/**
 * Place them now (sharing resilience §4.3), asked: a safety copy first (A8 review M-9: the rows that come in move
 * balances), then the whole log again in the book's turn. `onPlaced` gets the line that says how it went.
 */
export function PlaceHeldSheet({ bookId, onClose, onPlaced }: { bookId: string; onClose: () => void; onPlaced: (line: string) => void }) {
  const { database, sync } = useApp();
  const safetyCopy = useSafetyCopy('before-place');
  const roles = useCopyRoles(bookId).data;
  const { busy, error, run } = useActionRunner();
  const [refused, setRefused] = useState<string | null>(null);
  return (
    <Sheet
      title={PLACE_TITLE}
      onClose={onClose}
      confirm={{
        label: PLACE_LABEL,
        disabled: busy,
        run: () =>
          void run(async () => {
            setRefused(null);
            await safetyCopy();
            try {
              onPlaced(placedLine(await sync.placeHeldRows(bookId)));
            } catch (failure) {
              // A holder turned up meanwhile: said in the copies' own labels, and as a share to leave when it is one.
              if (!(failure instanceof SharingError && failure.code === 'HELD_ELSEWHERE')) throw failure;
              const held = await heldElsewhereOf(database, bookId);
              setRefused(heldLine(held.map((row) => ({ holderName: roles?.labels[row.holderBookId] ?? row.holderName, holderExists: row.holderExists, holderStillShared: roles?.stillShared[row.holderBookId] ?? false }))) ?? failure.message);
              return;
            }
            onClose();
          }),
      }}
    >
      <ErrorBox error={error} />
      {refused ? (
        <p data-testid="place-refused" className="pb-[8px] text-[15px] leading-[20px] text-[var(--ph-warn)]">
          {refused}
        </p>
      ) : null}
      <p className="text-[15px] leading-[20px]">{PLACE_CONFIRM}</p>
    </Sheet>
  );
}
