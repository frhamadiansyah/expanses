import { useCouponsAtStart } from '../features/networth/coupons-at-start';
import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { sweepPhotosAtStart } from '../photos/sweep-at-start';
import { cx } from '../ui';
import { ToastHost } from '../ui/Toast';
import { EventModeHost } from '../features/events/EventMode';
import { useApp } from './context';
import { AppNotices, DeskNotices } from './DeskNotices';
import { Sidebar } from './Sidebar';
import { edgeToEdge, SETTINGS_TO } from './sidebar-model';
import { panelBase } from './form-panel-model';
import { FormPanelHost } from './FormPanelHost';
import { TabBar } from './TabBar';
import { usePhone, useSideways } from './use-phone';
import { rotationFor, useCashflowRotation } from '../native/orientation';
import { useYahooClosesAtStart } from '../features/prices/yahoo';
import { useWidgetSummaryWriter } from '../features/account/use-widget-writer';
import { useICloudBackupAtStart } from '../features/backup/icloud/runner';
import { useForeignRecalcAtStart } from '../features/accounts/withdrawal-rate-start';
import { useReceiptPeekHost } from '../features/transactions/ReceiptPeekHost';

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
  const accountScoped = useRouterState({ select: (s) => typeof (s.location.search as { account?: unknown }).account === 'string' });
  useCashflowRotation(pathname);
  const phoneShell = phone || sideways;
  /*
   * A form on a wide screen floats in a panel over the page it was opened from (option C): that page is the last address
   * that was not a form, or — the form opened from outside — the page the form belongs to.
   */
  // Read off the address the router has *resolved*, not the one it is going to: the Outlet still draws the old route
  // until the new one is ready, and the panel opening or closing a moment before that would mount the old route again
  // (an edit form, saved, reading its transaction back void and sending the app to its receipt).
  const shown = useRouterState({ select: (s) => s.resolvedLocation ?? s.location });
  const href = shown.href;
  const formBase = phoneShell ? null : panelBase(shown.pathname);
  const lastPage = useRef<string | null>(null);
  if (formBase === null) lastPage.current = href;
  const baseHref = formBase === null ? null : (lastPage.current ?? formBase);
  const tableOnly = sideways && rotationFor(pathname) === 'free';
  // A Mac page that draws its own title bar: the bar is the window's top edge, and the notices sit under it (`DeskNotices`).
  const basePath = baseHref ? (baseHref.split(/[?#]/)[0] ?? baseHref) : null;
  const ownBar = basePath ? edgeToEdge(basePath, false, /[?&]account=/.test(baseHref ?? '')) : edgeToEdge(pathname, phoneShell, accountScoped);
  const deskBar = ownBar && !phoneShell;
  // The Mac receipt a transaction opens on a wide screen, wherever it is opened from but Cashflow's own table.
  const receiptPeek = useReceiptPeekHost(!phoneShell);

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
  /*
   * A wide screen (the Mac app, a desktop browser) has no bounce to show: the page never pulls past its top or foot, so
   * no other colour shows above the title bar (`html[data-desk]`, styles.css). A phone keeps its own bounce.
   */
  useEffect(() => {
    const root = document.documentElement;
    if (phoneShell) delete root.dataset.desk;
    else root.dataset.desk = ownBar ? 'bar' : '';
    return () => {
      delete root.dataset.desk;
    };
  }, [phoneShell, ownBar]);
  useEffect(() => {
    const sentinel = top.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(entry ? !entry.isIntersecting : false));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return receiptPeek.provide(
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
      {/* While a receipt peek stands on its own (an account's history), the page keeps clear of it rather than under it. */}
      {/* A wide screen draws to the window's top: the Mac app's hidden title bar (SceneDelegate.swift) leaves its inset
          to the page, and the page's own bar takes it — the window's buttons sit over the sidebar. */}
      <main className={cx('relative flex-1', phoneShell ? 'pb-32' : deskBar ? undefined : 'pb-8', receiptPeek.room && 'pr-[330px]')} style={phoneShell ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
        {/* Out of view the moment anything has scrolled under the status bar; watched, not listened to. */}
        <div ref={top} aria-hidden className="pointer-events-none absolute top-0 left-0 h-px w-px" />
        {/* The Mac pages draw their own title bar and grey page edge to edge (`edgeToEdge`); every other page sits in the column. */}
        {/* `mk`: the Mac look v1 (tokens.css) on the wide screen's own pages; the phone and the column keep theirs. */}
        {/* The column on a wide screen is the Mac look v1 too (`mk`): a white page, grey cards, the screen's own title bar
            (`LargeTitle` on a wide screen) and thin notices; the phone's column is its own. */}
        {baseHref ? (
          <FormPanelHost baseHref={baseHref}>
            <Outlet />
          </FormPanelHost>
        ) : (
        <div className={ownBar ? cx('w-full', deskBar && 'mk') : phoneShell ? 'desk-column mx-auto max-w-4xl p-4 md:p-8' : 'desk-column mk mk-col w-full max-w-[1000px] pb-8'}>
          {/* A Mac page with its own title bar draws the notices under it; every other page has them here, above it. */}
          {!deskBar && (phoneShell ? <AppNotices /> : <DeskNotices column />)}
          {/* The column's screens take back its padding to paint their own ground (`ph-screen`, -m-8), so it is kept as they expect. */}
          {phoneShell ? <Outlet /> : <div className="mk-col-body">{<Outlet />}</div>}
        </div>
        )}
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
    </div>,
  );
}
