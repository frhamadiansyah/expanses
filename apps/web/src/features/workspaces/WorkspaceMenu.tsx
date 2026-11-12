import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useEscape } from '../../app/use-escape';
import { cx, ErrorBox } from '../../ui';
import { WorkspaceDot } from './WorkspaceBadge';
import { useBooks } from './queries';
import { EventModeMenuRow, useShownEventMode } from '../events/EventMode';

/**
 * Cashflow's corner menu: one row per workspace, hung under the corner button. A tap switches and closes it; a tap
 * outside, or Escape, closes it without switching. Fixed to the screen, so it is under the button wherever the page is
 * scrolled to.
 */
export function WorkspaceMenu({ onClose }: { onClose: () => void }) {
  const { ws, switchBook } = useApp();
  const books = useBooks();
  // Event mode on (2F): the event is the menu's top row, a tap to its page where the switch is.
  const eventMode = useShownEventMode();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEscape(onClose);

  async function choose(bookId: string) {
    if (bookId === ws.bookId) return onClose();
    setBusy(true);
    setError(null);
    try {
      await switchBook(bookId);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" aria-label="Close workspaces" tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={onClose} />
      <div
        role="menu"
        aria-label="Workspaces"
        data-testid="workspace-menu"
        className="fixed top-[calc(env(safe-area-inset-top)+60px)] right-4 z-30 w-[230px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[14px] bg-[var(--ph-surface)] shadow-[0_8px_30px_rgba(0,0,0,0.27)]"
      >
        {error !== null && <ErrorBox error={error} />}
        {eventMode && <EventModeMenuRow active={eventMode} onClose={onClose} />}
        {(books.data ?? []).map((book) => {
          const open = book.id === ws.bookId;
          return (
            <button
              key={book.id}
              type="button"
              role="menuitemradio"
              aria-checked={open}
              data-testid="workspace-choice"
              disabled={busy}
              onClick={() => void choose(book.id)}
              className={cx(
                'flex min-h-11 w-full items-center gap-2.5 border-t-[0.5px] border-[var(--ph-hair)] px-3.5 py-3 text-left text-[15px] text-[var(--ph-ink)] disabled:opacity-60',
                !eventMode && 'first:border-t-0',
                open && 'font-semibold',
              )}
            >
              <WorkspaceDot book={book} />
              <span className="min-w-0 flex-1 truncate">{book.name}</span>
              {open && <Check size={16} aria-hidden className="shrink-0" />}
            </button>
          );
        })}
      </div>
    </>
  );
}
