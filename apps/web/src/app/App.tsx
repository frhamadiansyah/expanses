import { autoLinkInstalmentPlans, refreshPlanSpreads, repairInstalmentCounting, seedShareListAsked, setActiveBook } from '@expanses/db';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { watchCaptures } from '../capture/drain';
import { installCaptureTestHook } from '../capture/test-hook';
import type { AppDb } from '../db/bootstrap';
import { backgroundCopyFor, watchLeaving } from '../db/background-copy';
import { scheduleDailyCopy } from '../db/snapshots';
import { watchNetWorthAutoSteps } from '../features/sharing/household';
import { listenForAddLinks, listenForJoinLinks, listenForReviewLinks, listenForStatementLinks } from '../native/deep-link';
import type { SyncService } from '../sync/sync-service';
import { type AppState, AppContext } from './context';
import { hydratePrefs } from '../lib/synced-prefs';
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
  // Link my devices: the owner's own devices sync behind every screen too; what another one wrote re-reads them all,
  // and the choices kept on the device are read again from what arrived (lib/synced-prefs.ts).
  useEffect(() => {
    const off = app.self.whenApplied(() => {
      void hydratePrefs(app.database).finally(() => void queryClient.invalidateQueries());
    });
    void app.self.start().catch((error: unknown) => console.warn('Linked devices did not start', error));
    return () => {
      off();
      app.self.stop();
    };
  }, [app.self, app.database, queryClient]);
  /*
   * Household sharing, simplified (2026-11-13): the partner's Confirm of a net worth group filed separately, and this
   * person's review of one, happen by themselves after each sync run — through the same actions their buttons ran.
   */
  useEffect(
    () =>
      watchNetWorthAutoSteps({ database: app.database, ws: app.ws, sync }, () => {
        // Only what a confirm or a review changes is read again (review round 1, item 8): never every figure at once.
        for (const key of ['net-worth', 'share-list', 'sharing']) void queryClient.invalidateQueries({ queryKey: [key] });
      }),
    [app.database, app.ws, sync, queryClient],
  );
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
  /*
   * Card instalments (owner, 16 Nov 2026: "I don't want to pick manually"): the plans saved before a plan could name its
   * purchase are tied to it once, on this device, when the app opens (`autoLinkInstalmentPlans`). A plan the owner sets
   * back to None afterwards is left alone; only figures it changed are read again.
   */
  useEffect(() => {
    void autoLinkInstalmentPlans(app.database, app.ws)
      // The app decides how a plan counts (TF 139): a plan tied to a spending purchase is moved to Each month, once.
      .then(async (report) => {
        const repaired = await repairInstalmentCounting(app.database, app.ws);
        if ((report && report.linked > 0) || (repaired && repaired.moved > 0)) void queryClient.invalidateQueries();
      })
      // A plan with no purchase keeps its shared row in step with the card's records (0123): a moved opening balance.
      .then(() => refreshPlanSpreads(app.database, app.ws))
      .catch((error: unknown) => console.warn('Instalment plans were not linked', error));
  }, [app.database, app.ws, queryClient]);
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
