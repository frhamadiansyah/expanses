import { setActiveBook } from '@expanses/db';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { AppDb } from '../db/bootstrap';
import { scheduleDailyCopy } from '../db/snapshots';
import { listenForJoinLinks } from '../native/deep-link';
import type { SyncService } from '../sync/sync-service';
import { type AppState, AppContext } from './context';
import { router } from './router';

export function App({ app, sync: given }: { app: AppDb; sync?: SyncService }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }),
  );
  // The open workspace is state rather than something read once at startup, so choosing another one re-reads
  // every book-scoped screen without reloading the app.
  const [bookId, setBookId] = useState(app.ws.bookId);
  // The open readied it before its first write (`openAppDb`, spec §5.1); a test may hand one in instead.
  const [sync] = useState(() => given ?? app.sync);
  /*
   * Sharing syncs behind every screen and never in front of one (spec §9.4): a run that applied another device's
   * changes drops every cached figure, so whatever is on screen re-reads. With nothing shared, `start` sends nothing.
   */
  useEffect(() => {
    const off = sync.whenApplied(() => void queryClient.invalidateQueries());
    void sync.start().catch((error: unknown) => console.warn('Sync did not start', error));
    return () => {
      off();
      sync.stop();
    };
  }, [sync, queryClient]);
  // A `cicis://join/…` link opened while the shell runs, or the one it was launched by, lands on Join a workspace, the code in
  // the fragment rather than the path.
  useEffect(() => listenForJoinLinks((code) => void router.navigate({ to: '/join', hash: code })), []);
  // The day's safety copy, queued for the first idle moment after this screen has painted. It never
  // blocks a paint, and it is what stands behind "Restore the last good copy" on a device that has not
  // had an update in months.
  useEffect(() => {
    if (app.safety) scheduleDailyCopy(app.safety);
  }, [app.safety]);
  const value = useMemo<AppState>(
    () => ({
      ...app,
      ws: { ...app.ws, bookId },
      sync,
      switchBook: async (next) => {
        await setActiveBook(app.database, app.ws, next);
        setBookId(next);
        // Removed, not invalidated: an invalidated query keeps showing its old data while it refetches, and that
        // data is another workspace's money.
        queryClient.removeQueries();
      },
    }),
    [app, bookId, queryClient, sync],
  );
  return (
    <AppContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AppContext.Provider>
  );
}
