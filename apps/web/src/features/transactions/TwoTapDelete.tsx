import { useState } from 'react';
import { cx } from '../../ui';

/**
 * Deleting asks twice, in place — the same two taps the list and the table already ask for.
 *
 * Its own file because the receipt and the phone's edit sheet both draw it, and the two have to ask the same
 * question in the same words: a second copy is a second chance for one way in to delete on a single tap.
 */
export function TwoTapDelete({ busy, onConfirm, className }: { busy: boolean; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={armed ? 'Click again to delete' : 'Delete this transaction'}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={cx(
        'min-h-11 rounded-lg px-3 text-sm font-medium disabled:opacity-60',
        armed ? 'bg-red-700 text-white' : 'text-red-700 hover:bg-red-50',
        className,
      )}
    >
      {armed ? 'Click again to delete' : 'Delete'}
    </button>
  );
}
