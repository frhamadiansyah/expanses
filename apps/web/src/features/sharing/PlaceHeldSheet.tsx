import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { useSafetyCopy } from '../workspaces/safety-copy';
import { useActionRunner } from './share-hooks';
import { PLACE_CONFIRM, PLACE_LABEL, PLACE_TITLE, placedLine } from './sharing-copy';

/**
 * Place them now (sharing resilience §4.3), asked: a safety copy first (A8 review M-9: the rows that come in move
 * balances), then the whole log again in the book's turn. `onPlaced` gets the line that says how it went.
 */
export function PlaceHeldSheet({ bookId, onClose, onPlaced }: { bookId: string; onClose: () => void; onPlaced: (line: string) => void }) {
  const { sync } = useApp();
  const safetyCopy = useSafetyCopy('before-place');
  const { busy, error, run } = useActionRunner();
  return (
    <Sheet
      title={PLACE_TITLE}
      onClose={onClose}
      confirm={{
        label: PLACE_LABEL,
        disabled: busy,
        run: () =>
          void run(async () => {
            await safetyCopy();
            onPlaced(placedLine(await sync.placeHeldRows(bookId)));
            onClose();
          }),
      }}
    >
      <ErrorBox error={error} />
      <p className="text-[15px] leading-[20px]">{PLACE_CONFIRM}</p>
    </Sheet>
  );
}
