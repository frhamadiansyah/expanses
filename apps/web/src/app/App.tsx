import { seedShareListAsked, setActiveBook } from '@expanses/db';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { watchCaptures } from '../capture/drain';
import { installCaptureTestHook } from '../capture/test-hook';
import type { AppDb } from '../db/bootstrap';
import { backgroundCopyFor, watchLeaving } from '../db/background-copy';
import { scheduleDailyCopy } from '../db/snapshots';
import { listenForAddLinks, listenForJoinLinks, listenForReviewLinks, listenForStatementLinks } from '../native/deep-link';
import type { SyncService } from '../sync/sync-service';
import { type AppState, AppContext } from './context';
import { createAppQueryClient } from './query-client';
import { router } from './router';

export function App({ app, sync: given }: { app: AppDb; sync?: SyncService }) {
  const [queryClient] = useState(createAppQueryClient);
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
    // The share list's first run (fix round 1, 5): members already joined count as offered, before a sync brings anyone
    // new. The sync waits for it — one small read, and never more than 3 s, so a seed that hangs cannot keep sharing
    // from starting; a failure only means the Share page seeds it instead. Unmounted before then, nothing starts.
    let cancelled = false;
    const seeded = seedShareListAsked(app.database).catch((error: unknown) => console.warn('Share list seed did not run', error));
    void Promise.race([seeded, new Promise<void>((resolve) => setTimeout(resolve, 3_000))]).finally(() => {
      if (cancelled) return;
      void sync.start().catch((error: unknown) => console.warn('Sync did not start', error));
    });
    return () => {
      cancelled = true;
      off();
      sync.stop();
    };
  }, [sync, queryClient]);
  // A `cicis://join/…` link opened while the shell runs, or the one it was launched by, lands on Join a workspace, the code in
  // the fragment rather than the path.
  useEffect(() => listenForJoinLinks((code) => void router.navigate({ to: '/join', hash: code })), []);
  useEffect(() => listenForReviewLinks(() => void router.navigate({ to: '/review' })), []);
  // Several statement screenshots shared from Photos: already read on the phone, they wait for the owner to say which
  // card they belong to (statement-check S2).
  useEffect(() => listenForStatementLinks((batch) => void router.navigate({ to: '/statement/shared', search: { batch } })), []);
  // The widget's buttons and the Control Center control (`cicis://add/line|paste|receipt`): One line, Paste a list, or
  // Cashflow starting Scan a receipt — the same three ways the hold-＋ menu offers.
  useEffect(
    () =>
      listenForAddLinks(
        (link) =>
          void router.navigate(link === 'line' ? { to: '/transactions/line' } : link === 'paste' ? { to: '/transactions/paste' } : { to: '/transactions', search: { scan: true } }),
      ),
    [],
  );
  /*
   * Captures wait in the phone's holding area while the app is closed — a shortcut or the share sheet cannot reach
   * the database. Draining turns them into drafts when the app opens and every time it comes back to the front,
   * which is exactly when a backlog arrives; a drain that found nothing touches no cache at all.
   */
  useEffect(
    () => watchCaptures(app.database, app.ws, () => void queryClient.invalidateQueries()),
    [app.database, app.ws, queryClient],
  );
  // The day's safety copy, queued for the first idle moment after this screen has painted. It never
  // blocks a paint, and it is what stands behind "Restore the last good copy" on a device that has not
  // had an update in months.
  useEffect(() => {
    if (app.safety) scheduleDailyCopy(app.safety);
  }, [app.safety]);
  // And a copy each time the app goes to the background with something new written, at most every ten minutes,
  // so the entries made since the day's copy have one too. Only the newest such copy is kept.
  useEffect(() => {
    const copy = app.safety ? backgroundCopyFor(app.safety) : null;
    return copy ? watchLeaving(() => void copy()) : undefined;
  }, [app.safety]);
  // E2E builds only: a journey's way to hand the queue the captures a phone would have drained. A no-op otherwise.
  useEffect(() => {
    installCaptureTestHook({ database: app.database, ws: app.ws, onCaptured: () => void queryClient.invalidateQueries() });
  }, [app, queryClient]);
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
