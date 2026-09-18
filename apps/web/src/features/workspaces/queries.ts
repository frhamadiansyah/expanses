import { isoDate, monthOf, monthRange } from '@expanses/core';
import { bookNamesOf, listBooks, spentThisMonthByBook } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** Every workspace under this owner, open ones only, in the order the switcher shows them. */
export function useBooks() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['books', ws.workspaceId], queryFn: () => listBooks(database, ws) });
}

/** The open workspace's own row: its base currency, and whether events count in its budget. */
export function useOpenBook() {
  const { ws } = useApp();
  return (useBooks().data ?? []).find((book) => book.id === ws.bookId) ?? null;
}

/**
 * What every workspace spent this calendar month, keyed by workspace id — what the switcher shows beside each
 * name, so choosing one is a decision made with a figure rather than only a word.
 */
export function useSpentThisMonth() {
  const { database, ws } = useApp();
  const month = monthOf(isoDate());
  const { from, to } = monthRange(month);
  // Not narrowed by the open workspace: this is every workspace's figure at once, asked for once.
  return useQuery({ queryKey: ['book-spent', ws.workspaceId, month], queryFn: () => spentThisMonthByBook(database, ws, from, to) });
}

/**
 * Which workspace each row belongs to — for a card's statement and for an account's history, both of which are
 * yours and so hold every workspace. Answers nothing at all while the owner has only one workspace, since a badge
 * that is always the same word says nothing.
 */
export function useWorkspaceBadges(transactionIds: readonly string[]) {
  const { database, ws } = useApp();
  const many = (useBooks().data ?? []).length > 1;
  // Sorted, so the same set of rows in a different order reuses the answer rather than asking again.
  const ids = [...transactionIds].sort();
  const query = useQuery({
    queryKey: ['book-names', ws.workspaceId, ids.join(',')],
    enabled: many && ids.length > 0,
    queryFn: () => bookNamesOf(database, ws, ids),
  });
  return (transactionId: string) => (many ? (query.data?.[transactionId] ?? null) : null);
}
