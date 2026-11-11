import { heldElsewhereOf, listArchivedBooks, listBooks, listSharedBooks, memberSilence, ownersGone, purchasePayers, type ShareRecordFinding, sharingDetail } from '@expanses/db';
import { copyLabel } from './sharing-copy';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import type { BookSyncStatus } from '../../sync/sync-service';
import { workspaceBooks } from './workspace-books';

/**
 * Every shared workspace on this device, with its members: the switcher's "Shared with …". A shared event's book is
 * left out (`workspaceBooks`): it is no workspace, so no screen that lists or looks one up should meet it.
 */
export function useSharedBooks() {
  const { database } = useApp();
  return useQuery({ queryKey: ['shared-books'], queryFn: async () => workspaceBooks(await listSharedBooks(database)) });
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

/**
 * What the Share page says beside the status line (sharing resilience §4.4, §8.1): the rows another copy here holds,
 * how long since each other member last changed anything, and whether the owners have been quiet long enough to keep
 * the copy as own. Re-read after every run (the `sharing` key). Local reads only.
 */
export function useShareHealth(bookId: string) {
  const { database, sync } = useApp();
  return useQuery({
    queryKey: ['sharing', bookId, 'health'],
    queryFn: async () => {
      const deviceId = await sync.deviceId();
      const now = Date.now();
      return {
        held: await heldElsewhereOf(database, bookId),
        silence: deviceId ? await memberSilence(database, bookId, deviceId, now) : [],
        ownersGone: deviceId ? await ownersGone(database, bookId, deviceId, now) : { gone: false, since: null },
      };
    },
  });
}

/** What the share records said at open (§6.2), kept current as findings are dealt with. */
export function useShareFindings(): ShareRecordFinding[] {
  const { sync } = useApp();
  const [found, setFound] = useState(() => sync.findings());
  useEffect(() => {
    setFound(sync.findings());
    return sync.subscribe(() => setFound(sync.findings()));
  }, [sync]);
  return found;
}

/** Whether this workspace lost its share on this phone (§6.2 `lost`): the Share row, the workspace page and Share say so. */
export function useLostHere(bookId: string): boolean {
  return useShareFindings().some((finding) => finding.kind === 'lost' && finding.bookId === bookId);
}

export interface CopyRef {
  bookId: string;
  /** "Home · joined 3 Oct": the name, and when, so two copies of one name are told apart (A8 review I-2). */
  label: string;
}

/**
 * Which copy a workspace is, beside others of the same workspace here (A8 review I-2, I-5): its own label; the newer
 * shares that wait on rows this copy holds (`holdsFor`: deleting this copy lets them come in); and the copies that
 * hold rows of this one's share (`heldBy`: this is the newer share). Local reads only, re-read after every run.
 */
export function useCopyRoles(bookId: string) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['sharing', bookId, 'roles'],
    queryFn: async () => {
      const now = Date.now();
      const shared = workspaceBooks(await listSharedBooks(database));
      const books = [...(await listBooks(database, ws)), ...(await listArchivedBooks(database, ws))];
      const labelOf = (id: string): string => {
        const book = books.find((each) => each.id === id);
        const row = shared.find((each) => each.bookId === id);
        if (!book) return 'another copy';
        return copyLabel({ name: book.name, joined: book.kind === 'shared', sharedAt: row?.sharedAt ?? null }, now);
      };
      const heldBy = [...new Set((await heldElsewhereOf(database, bookId)).filter((row) => row.holderExists).map((row) => row.holderBookId))];
      const holdsFor: string[] = [];
      for (const other of shared) {
        if (other.bookId === bookId || other.state !== 'active') continue;
        if ((await heldElsewhereOf(database, other.bookId)).some((row) => row.holderBookId === bookId)) holdsFor.push(other.bookId);
      }
      const ref = (id: string): CopyRef => ({ bookId: id, label: labelOf(id) });
      return { label: labelOf(bookId), holdsFor: holdsFor.map(ref), heldBy: heldBy.map(ref), labels: Object.fromEntries(books.map((b) => [b.id, labelOf(b.id)])) as Record<string, string> };
    },
  });
}
