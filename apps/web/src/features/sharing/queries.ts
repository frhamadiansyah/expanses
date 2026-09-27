import { listSharedBooks, purchasePayers, sharingDetail } from '@expanses/db';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import type { BookSyncStatus } from '../../sync/sync-service';

/** Every shared book on this device, with its members: the switcher's "Shared with …". */
export function useSharedBooks() {
  const { database } = useApp();
  return useQuery({ queryKey: ['shared-books'], queryFn: () => listSharedBooks(database) });
}

/** One book's sharing, as its settings show it (§11), re-read after every sync run. */
export function useSharingDetail(bookId: string) {
  const { database, sync } = useApp();
  const queryClient = useQueryClient();
  useEffect(() => sync.subscribe(() => void queryClient.invalidateQueries({ queryKey: ['sharing', bookId] })), [sync, queryClient, bookId]);
  return useQuery({
    queryKey: ['sharing', bookId],
    queryFn: async () => sharingDetail(database, bookId, await sync.deviceId()),
  });
}

/** What the sync service knows about a book's last run, kept current as runs finish. */
export function useSyncStatus(bookId: string): BookSyncStatus {
  const { sync } = useApp();
  const [status, setStatus] = useState(() => sync.status(bookId));
  useEffect(() => {
    setStatus(sync.status(bookId));
    return sync.subscribe(() => setStatus(sync.status(bookId)));
  }, [sync, bookId]);
  return status;
}

/**
 * Who paid for each of these transactions, where it heads a purchase in a shared book (§4.3, §11). Asks nothing while
 * the open workspace is not shared, so an ordinary list costs no extra query.
 */
export function usePurchasePayers(transactionIds: readonly string[], shared: boolean) {
  const { database, ws } = useApp();
  const ids = [...transactionIds].sort();
  const query = useQuery({
    queryKey: ['payers', ws.bookId ?? null, ids.join(',')],
    enabled: shared && ids.length > 0,
    queryFn: () => purchasePayers(database, ids),
    // A list that grows by one row keeps what it knew about the others while it asks again: no row flickers back
    // to the placeholder's name in between (fix round 1).
    placeholderData: keepPreviousData,
  });
  return (transactionId: string) => (shared ? (query.data?.[transactionId] ?? null) : null);
}

/** The engine's status line state for a book (§11) and whether it is frozen (§8.5), re-read after every run. */
export function useBookStatus(bookId: string) {
  const { sync } = useApp();
  return useQuery({
    queryKey: ['sharing', bookId, 'status'],
    queryFn: async () => ({ status: await sync.bookStatus(bookId), frozen: await sync.isFrozen(bookId) }),
  });
}

/**
 * Whether the open workspace is a share that ended here (§8.6): kept as it was, read-only. Every way in that writes
 * to it hides or refuses; capture refuses the write itself whatever the screen does (`BookReadOnlyError`).
 */
export function useOpenBookReadOnly(): boolean {
  const { ws } = useApp();
  const shared = useSharedBooks();
  return (shared.data ?? []).some((book) => book.bookId === ws.bookId && book.state === 'unshared');
}
