import { formatMinor } from '@expanses/core';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox } from '../../ui';
import { useSharedBooks } from '../sharing/queries';
import { endedLine, sharedWith } from '../sharing/sharing-copy';
import { WorkspaceDot } from './WorkspaceBadge';
import { useBooks, useSpentThisMonth } from './queries';

/**
 * The list of workspaces, and the way between them.
 *
 * Each row carries what that workspace spent this month, because the name alone rarely says which one you meant.
 * Switching only: making and joining a workspace live on the Account page. Choosing one changes what the whole app reads, so the sheet closes straight after: staying open over figures
 * that have just been thrown away would only invite a second tap on the row you already chose.
 */
export function WorkspaceSheet({ onClose }: { onClose: () => void }) {
  const { ws, workspaceName, switchBook } = useApp();
  const books = useBooks();
  const spent = useSpentThisMonth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const shared = useSharedBooks();
  /** A shared book's subtitle (spec §11): who it is shared with, or that it no longer is. */
  const sharing = (bookId: string) => {
    const book = (shared.data ?? []).find((each) => each.bookId === bookId);
    if (!book) return null;
    if (book.state === 'unshared') {
      const byName = book.members.find((member) => member.memberId === book.unsharedBy)?.name ?? null;
      return endedLine({ byName, byYou: book.unsharedBy !== null && book.unsharedBy === book.memberId, removed: book.unsharedReason === 'removed' });
    }
    return sharedWith(book.members, book.memberId);
  };

  async function choose(bookId: string) {
    if (bookId === ws.bookId) return onClose();
    setBusy(bookId);
    setError(null);
    try {
      await switchBook(bookId);
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet title="Workspaces" onClose={onClose}>
      <ErrorBox error={error} />
      <div className="-mx-1">
        {books.isSuccess && books.data.length === 0 && <p className="px-1 py-3 text-sm text-slate-500">{workspaceName} has no workspaces yet.</p>}
        <ul className="divide-y divide-slate-100">
          {(books.data ?? []).map((book) => {
            const open = book.id === ws.bookId;
            return (
              <li key={book.id}>
                <button
                  type="button"
                  data-testid="workspace-choice"
                  aria-current={open ? 'true' : undefined}
                  disabled={busy !== null}
                  onClick={() => void choose(book.id)}
                  // 44px is the smallest a finger can be asked to hit; the rows are the whole point of the sheet.
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
                >
                  <WorkspaceDot book={book} />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block truncate text-sm', open && 'font-semibold')}>{book.name}</span>
                    {/* Each workspace's own currency, as that workspace's own screens show it. */}
                    {sharing(book.id) && (
                      <span data-testid="workspace-shared-with" className="block truncate text-xs text-slate-600">
                        {sharing(book.id)}
                      </span>
                    )}
                    <span className="block text-xs text-slate-500">
                      {spent.isSuccess
                        ? `Spent ${formatMinor(spent.data[book.id]?.amountMinor ?? 0, spent.data[book.id]?.currency ?? book.baseCurrency)} this month`
                        : 'Spent this month…'}
                    </span>
                  </span>
                  {open && <Check size={16} aria-label="Open" className="shrink-0 text-slate-900" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
