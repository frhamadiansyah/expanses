import { bookNamesOf, listBooks } from '@expanses/db';
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
