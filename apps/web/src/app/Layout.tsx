import { useCouponsAtStart } from '../features/networth/coupons-at-start';
import { Link, Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { sweepPhotosAtStart } from '../photos/sweep-at-start';
import { AfterUpdateCard } from '../features/backup/AfterUpdateCard';
import { BackupBanner } from '../features/backup/BackupBanner';
import { InstallHint } from '../features/pwa/InstallHint';
import { ReadOnlyNotice } from '../features/sharing/ReadOnlyNotice';
import { usePendingDraftCount } from '../features/review/queries';
import { useOpenBook } from '../features/workspaces/queries';
import { WorkspaceDot } from '../features/workspaces/WorkspaceBadge';
import { WorkspaceSheet } from '../features/workspaces/WorkspaceSheet';
import { cx } from '../ui';
import { ToastHost } from '../ui/Toast';
import { useApp } from './context';
import { TabBar } from './TabBar';
import { usePhone, useSideways } from './use-phone';
import { rotationFor, useCashflowRotation } from '../native/orientation';
import { useYahooClosesAtStart } from '../features/prices/yahoo';
import { useWidgetSummaryWriter } from '../features/account/use-widget-writer';
import { useICloudBackupAtStart } from '../features/backup/icloud/runner';
import { useForeignRecalcAtStart } from '../features/accounts/withdrawal-rate-start';
import { WithdrawalRateNotice } from '../features/accounts/WithdrawalRateNotice';
import { lateNote } from '../features/debt-plan/plan-view';
import { useLateDebtCount } from '../features/debt-plan/queries';

const NAV = [
  { to: '/transactions', label: 'Transactions' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/budget', label: 'Budget' },
  { to: '/events', label: 'Events' },
  { to: '/goals', label: 'Goals' },
  { to: '/categories', label: 'Categories' },
  { to: '/net-worth', label: 'Net worth' },
] as const;

const MORE = [
  { to: '/calculators', label: 'Calculators' },
  { to: '/tax-report', label: 'Tax report' },
  { to: '/recommend', label: 'Which card?' },
  { to: '/import', label: 'Import' },
  { to: '/backup', label: 'Backup' },
  { to: '/account', label: 'Account' },
] as const;

/**
 * The queue is only useful if you can tell from anywhere that something is waiting in it, so the
 * count rides on the link rather than being something to remember to go and look at.
 */
/** The Debt-free plan, one step in under Net worth, with a red pill while a debt is late (spec §4.5). */
function PlanLink() {
  const late = useLateDebtCount();
  return (
    <Link
      to="/net-worth/plan"
      className="flex items-center justify-between rounded-lg py-2 pr-3 pl-6 text-sm text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]"
      activeProps={{ className: 'bg-[var(--ph-fill)] font-medium text-[var(--ph-ink)]' }}
    >
      Debt-free plan
      {late > 0 && <span className="rounded-full bg-[var(--ph-alarm)] px-2 py-0.5 text-[11px] font-medium text-white">{lateNote(late)}</span>}
    </Link>
  );
}

function ReviewLink() {
  const pending = usePendingDraftCount().data ?? 0;
  return (
    <Link
      to="/review"
      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]"
      activeProps={{ className: 'bg-[var(--ph-fill)] font-medium text-[var(--ph-ink)]' }}
    >
      Review
      {pending > 0 && (
        <span className="rounded-full bg-[var(--ph-ink)] px-2 py-0.5 text-[11px] font-medium text-[var(--ph-surface)]">{pending}</span>
      )}
    </Link>
  );
}

export function Layout() {
  const { workspaceName, ws, database } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  // The phone reaches the switcher from Cashflow's ⋯; the sidebar is on every screen, so a wide screen
  // reaches it from more places than a phone does, never fewer.
  const [choosing, setChoosing] = useState(false);
  const openBook = useOpenBook();
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
      {!phoneShell && (
        <aside className="hidden w-56 shrink-0 border-r border-[var(--ph-hair)] bg-[var(--ph-surface)] p-4 md:block">
          <button
            type="button"
            aria-label="Workspace"
            onClick={() => setChoosing(true)}
            className="mb-6 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--ph-fill)]"
          >
            <WorkspaceDot book={openBook} />
            <span className="min-w-0 flex-1">
              <span className="block text-lg leading-tight font-semibold">Expanses</span>
              <span className="block truncate text-xs text-[var(--ph-ink-3)]">
                {openBook?.name ?? workspaceName} · {openBook?.baseCurrency ?? ws.baseCurrency} · on this device
              </span>
            </span>
            <ChevronsUpDown size={14} aria-hidden className="shrink-0 text-[var(--ph-ink-3)]" />
          </button>
          {choosing && <WorkspaceSheet onClose={() => setChoosing(false)} />}
          <nav className="space-y-1">
            {NAV.map((item) => (
              <div key={item.to} className="space-y-1">
                <Link
                  to={item.to}
                  className="block rounded-lg px-3 py-2 text-sm text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]"
                  activeProps={{ className: 'bg-[var(--ph-fill)] font-medium text-[var(--ph-ink)]' }}
                >
                  {item.label}
                </Link>
                {item.to === '/net-worth' && <PlanLink />}
              </div>
            ))}
          </nav>
          <div className="mt-6 space-y-1 border-t border-[var(--ph-hair)] pt-4">
            <ReviewLink />
            {MORE.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="block rounded-lg px-3 py-2 text-sm text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]"
                activeProps={{ className: 'bg-[var(--ph-fill)] font-medium text-[var(--ph-ink)]' }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </aside>
      )}
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
        <div className="mx-auto max-w-4xl p-4 md:p-8">
          <InstallHint />
          {/* What just happened to their data comes before the standing reminder about backing it up. */}
          <AfterUpdateCard />
          <WithdrawalRateNotice />
          <BackupBanner />
          {/* A share that ended here is read-only (§8.6), and every screen of it says so. */}
          <ReadOnlyNotice />
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
    </div>
  );
}
