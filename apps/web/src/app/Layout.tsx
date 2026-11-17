import { useCouponsAtStart } from '../features/networth/coupons-at-start';
import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { sweepPhotosAtStart } from '../photos/sweep-at-start';
import { AfterUpdateCard } from '../features/backup/AfterUpdateCard';
import { BackupBanner } from '../features/backup/BackupBanner';
import { InstallHint } from '../features/pwa/InstallHint';
import { ReadOnlyNotice } from '../features/sharing/ReadOnlyNotice';
import { RepairNotice } from '../features/sharing/RepairNotice';
import { cx } from '../ui';
import { ToastHost } from '../ui/Toast';
import { EventModeHost } from '../features/events/EventMode';
import { useApp } from './context';
import { Sidebar } from './Sidebar';
import { edgeToEdge, SETTINGS_TO } from './sidebar-model';
import { TabBar } from './TabBar';
import { usePhone, useSideways } from './use-phone';
import { rotationFor, useCashflowRotation } from '../native/orientation';
import { useYahooClosesAtStart } from '../features/prices/yahoo';
import { useWidgetSummaryWriter } from '../features/account/use-widget-writer';
import { useICloudBackupAtStart } from '../features/backup/icloud/runner';
import { useForeignRecalcAtStart } from '../features/accounts/withdrawal-rate-start';
import { WithdrawalRateNotice } from '../features/accounts/WithdrawalRateNotice';

export function Layout() {
  const { database } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const phone = usePhone();
  /*
   * A phone on its side is wider than md, yet still a phone: the shell keeps its phone parts by "is this a phone",
   * not by width alone. On Cashflow alone (the one route that may turn) it draws nothing of its own, and the page
   * draws the full-screen table. In the native app the turn itself is unlocked there and locked everywhere else.
   */
  const sideways = useSideways();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useCashflowRotation(pathname);
  const phoneShell = phone || sideways;
  const tableOnly = sideways && rotationFor(pathname) === 'free';

  /*
   * A form abandoned halfway leaves a picture in OPFS that no row names. Tidying them at start is the only
   * moment nobody is looking at a form, and it reads every workspace's rows: a sweep that knew only the open
   * workspace would count another workspace's pictures as orphans and delete them.
   *
   * `sweepPhotosAtStart` is the whole of it, and is tested as itself rather than copied into a test: the
   * database is asked which files are in use, and the sweep deletes only what that answer proves is not.
   * A database that cannot say — a device opened below a blocked update has no `transaction_photos` table —
   * and a restore that has just replaced the database both leave every photograph exactly where it is.
   * It answers 0 and breaks nothing where OPFS is absent, so a private window is fine too.
   */
  useEffect(() => {
    if (!database) return;
    void sweepPhotosAtStart(database).catch((error: unknown) => console.warn('Photos were not swept', error));
  }, [database]);
  // The Mac app's cicis › Settings… (⌘,): the shell raises this event (AppDelegate.swift) and Settings opens.
  useEffect(() => {
    const open = () => void navigate({ to: SETTINGS_TO });
    window.addEventListener('cicis:open-settings', open);
    return () => window.removeEventListener('cicis:open-settings', open);
  }, [navigate]);
  // The day's closes for the shares that follow Yahoo Finance, once a day each, behind whatever is on screen.
  useYahooClosesAtStart();
  // Bond coupons due since the app was last open, recorded on the bonds set to record their own.
  useCouponsAtStart();
  // The day's iCloud copy, in the iOS app with the switch on: at open, and each time the app comes back to the front.
  useICloudBackupAtStart(database);
  // Withdrawal rate (R18): foreign accounts recalculated behind whatever is on screen, one at a time.
  useForeignRecalcAtStart();
  // This month's spending for the home screen widget, when it is switched on (iOS app only).
  useWidgetSummaryWriter();

  // Whether the page has scrolled under the status bar: the glass over it is clear until then, as on iOS.
  const top = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sentinel = top.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="min-h-dvh md:flex"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      {/* The wide screen's sidebar (Mac sidebar A). A phone never draws it, so it never reads its counts or balances. */}
      {!phoneShell && <Sidebar />}
      {/* Frosted glass over the status bar, as iOS draws it: the page scrolls under the clock and battery
          rather than into them. Only as tall as the inset, so a desktop (inset 0) draws nothing. */}
      {phoneShell && (
        <div
          aria-hidden
          className={cx('ph-status-glass pointer-events-none fixed inset-x-0 top-0 z-30', scrolled && 'ph-edge-glass')}
          style={{ boxSizing: 'content-box', height: 'env(safe-area-inset-top)' }}
        />
      )}
      {/* The phone draws under the status bar and the home indicator, so the shell gives both back. */}
      <main className={cx('relative flex-1', phoneShell ? 'pb-32' : 'pb-8')} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Out of view the moment anything has scrolled under the status bar; watched, not listened to. */}
        <div ref={top} aria-hidden className="pointer-events-none absolute top-0 left-0 h-px w-px" />
        {/* The Mac pages draw their own title bar and grey page edge to edge (`edgeToEdge`); every other page sits in the column. */}
        <div className={edgeToEdge(pathname, phoneShell) ? 'w-full' : 'mx-auto max-w-4xl p-4 md:p-8'}>
          <InstallHint />
          {/* What just happened to their data comes before the standing reminder about backing it up. */}
          <AfterUpdateCard />
          <WithdrawalRateNotice />
          <BackupBanner />
          {/* A share that ended here is read-only (§8.6), and every screen of it says so. */}
          <ReadOnlyNotice />
          {/* Once: Family purchases the shared-book repair put right (sync gaps R2). */}
          <RepairNotice />
          <Outlet />
        </div>
      </main>
      {phoneShell && !tableOnly && (
        <>
          {/* Adding is a screen of its own, drawn the way every other subpage is: the form is long enough to scroll,
              and a sheet over the page it was opened from left two screens half-visible at once. */}
          <TabBar
            onAdd={() => {
              // Always a fresh Add form: from the Trade page the + replaces it (no `mode`, so Expense and its three tabs),
              // so Back goes where Trade was opened from rather than to a Trade page the person just left.
              const onTrade = router.state.location.pathname === '/transactions/new';
              void navigate({ to: '/transactions/new', replace: onTrade });
            }}
          />
        </>
      )}
      <ToastHost />
      <EventModeHost />
    </div>
  );
}
