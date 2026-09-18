import { useState } from 'react';
import { useApp } from '../../app/context';
import { cx } from '../../ui';
import { openToEditMessage, type RowBook } from './filing';

/**
 * Why a row in an account's history cannot be edited here, and the way to go and edit it where it lives.
 *
 * Offered rather than done quietly: opening another workspace changes every figure on the screen, so it is a
 * button somebody presses — and it lands on the workspace the row names, not on a list to choose from again.
 */
export function SwitchToEdit({ book, className }: { book: RowBook; className?: string }) {
  const { switchBook } = useApp();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <span
      data-testid="other-workspace-note"
      // The row around it is a click target of its own; pressing this must not be read as pressing that.
      onClick={(event) => event.stopPropagation()}
      className={cx('text-xs whitespace-normal text-slate-500', className)}
    >
      {failed ? `${book.name} could not be opened.` : openToEditMessage(book)}{' '}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(false);
          void switchBook(book.id)
            .catch(() => setFailed(true))
            .finally(() => setBusy(false));
        }}
        className="font-medium text-slate-700 underline underline-offset-2 disabled:opacity-60"
      >
        Open {book.name}
      </button>
    </span>
  );
}
