import { Home, MinusCircle, Plane } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';

/**
 * The list's select mode, at the foot of the screen: iOS's own toolbar — Done, how many are ticked, Actions — in place
 * of a floating card of buttons. Actions opens one grouped sheet with every thing that can be done to the ticked rows,
 * each a row; the event or workspace it needs is then chosen on the sheet that row opens.
 *
 * It sits where the Undo toast sits, above the phone's tab bar, so the toast that follows an action lands where the
 * bar just was. Its own error line, because a refusal said at the top of the page, while a thumb is down here, is a
 * refusal nobody sees.
 */
export function SelectBar({
  count,
  canRemove,
  busy,
  error,
  onAdd,
  onRemove,
  onCancel,
  onMove,
}: {
  count: number;
  /** Whether any ticked row is in an event at all; nothing else could be taken out of one. */
  canRemove: boolean;
  busy: boolean;
  error: unknown;
  onAdd: () => void;
  onRemove: () => void;
  onCancel: () => void;
  /** Move to workspace, offered while there is more than one workspace to move to. */
  onMove?: () => void;
}) {
  const [acting, setActing] = useState(false);
  const act = (run: () => void) => () => {
    setActing(false);
    run();
  };
  return (
    <>
      {/* Stood down while its sheet is up: drawn above the page, it would sit over the sheet's rows. */}
      {!acting && (
      <div
        role="toolbar"
        aria-label="Selected transactions"
        data-testid="select-bar"
        className="fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 border-t-[0.5px] border-[var(--ph-hair)] bg-[color-mix(in_srgb,var(--ph-ground)_94%,transparent)] backdrop-blur-md md:bottom-0"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4">
          <button type="button" onClick={onCancel} className="ph-focus min-h-11 shrink-0 text-[17px] text-[var(--ph-tint)]">
            Done
          </button>
          <span aria-live="polite" className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-[var(--ph-ink)]">
            {count === 0 ? 'None selected' : `${count} Selected`}
          </span>
          <button
            type="button"
            disabled={count === 0 || busy}
            onClick={() => setActing(true)}
            className="ph-focus min-h-11 shrink-0 text-[17px] font-semibold text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]"
          >
            Actions
          </button>
        </div>
        {error ? (
          <div className="mx-auto max-w-2xl px-4 pb-2">
            <ErrorBox error={error} />
          </div>
        ) : null}
      </div>
      )}
      {acting && (
        <Sheet grouped title={`${count} ${count === 1 ? 'transaction' : 'transactions'}`} onClose={() => setActing(false)}>
          <InsetGroup>
            <InsetRow icon={<Plane size={16} />} title="Add to event" onClick={act(onAdd)} />
            {onMove && <InsetRow icon={<Home size={16} />} title="Move to workspace" onClick={act(onMove)} />}
          </InsetGroup>
          <InsetGroup>
            <InsetRow icon={<MinusCircle size={16} />} title="Remove from event" disabled={!canRemove} chevron={false} onClick={act(onRemove)} />
          </InsetGroup>
        </Sheet>
      )}
    </>
  );
}
