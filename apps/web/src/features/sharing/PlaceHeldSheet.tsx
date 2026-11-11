import { heldElsewhereOf, SharingError } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { heldLineOf } from './copy-roles';
import { useCopyRoles } from './queries';
import { useActionRunner } from './share-hooks';
import { PLACE_CONFIRM, PLACE_LABEL, PLACE_TITLE, placedLine } from './sharing-copy';

/**
 * Place them now (sharing resilience §4.3), asked. A holder that turned up meanwhile is said first, in the copies' own
 * labels, with no safety copy taken (re-review m-3). Then a safety copy (review M-9: the rows that come in move
 * balances) and the whole log again in the book's turn. `onPlaced` gets the line that says how it went, naming where
 * purchases that need an account are (re-review m-4).
 */
export function PlaceHeldSheet({ bookId, onClose, onPlaced }: { bookId: string; onClose: () => void; onPlaced: (line: string) => void }) {
  const { database, sync } = useApp();
  const safetyCopy = useSafetyCopy('before-place');
  const roles = useCopyRoles(bookId).data;
  const { busy, error, run } = useActionRunner();
  const [refused, setRefused] = useState<string | null>(null);

  const stillHeld = async (): Promise<string | null> => {
    const held = await heldElsewhereOf(database, bookId);
    return held.some((row) => row.holderExists) ? heldLineOf(held, roles) : null;
  };

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
            const before = await stillHeld();
            if (before) {
              setRefused(before);
              return;
            }
            await safetyCopy();
            try {
              onPlaced(placedLine(await sync.placeHeldRows(bookId), roles?.label ?? null));
            } catch (failure) {
              if (!(failure instanceof SharingError && failure.code === 'HELD_ELSEWHERE')) throw failure;
              setRefused((await stillHeld()) ?? failure.message);
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
