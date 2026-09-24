import { Link, Outlet } from '@tanstack/react-router';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sweepPhotosAtStart } from '../photos/sweep-at-start';
import { AfterUpdateCard } from '../features/backup/AfterUpdateCard';
import { BackupBanner } from '../features/backup/BackupBanner';
import { InstallHint } from '../features/pwa/InstallHint';
import { usePendingDraftCount } from '../features/review/queries';
import { TransactionCard } from '../features/transactions/TransactionCard';
import { useOpenBook } from '../features/workspaces/queries';
import { WorkspaceDot } from '../features/workspaces/WorkspaceBadge';
import { WorkspaceSheet } from '../features/workspaces/WorkspaceSheet';
import { useApp } from './context';
import { AccountSheet } from './AccountSheet';
import { Sheet } from './Sheet';
import { TabBar } from './TabBar';
import { usePhone } from './use-phone';

const NAV = [
  { to: '/transactions', label: 'Transactions' },
  { to: '/cards', label: 'Cards' },
  { to: '/budget', label: 'Budget' },
  { to: '/events', label: 'Events' },
  { to: '/goals', label: 'Goals' },
  { to: '/accounts', label: 'Accounts' },
  { to: '/categories', label: 'Categories' },
  { to: '/net-worth', label: 'Net worth' },
] as const;

const MORE = [
  { to: '/calculators', label: 'Calculators' },
  { to: '/tax-report', label: 'Tax report' },
  { to: '/recommend', label: 'Which card?' },
  { to: '/import', label: 'Import CSV' },
  { to: '/backup', label: 'Backup' },
  { to: '/settings', label: 'Settings' },
] as const;

/**
 * The queue is only useful if you can tell from anywhere that something is waiting in it, so the
 * count rides on the link rather than being something to remember to go and look at.
 */
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
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  // The phone reaches the switcher from Cashflow's ⋯; the sidebar is on every screen, so a wide screen
  // reaches it from more places than a phone does, never fewer.
  const [choosing, setChoosing] = useState(false);
  const openBook = useOpenBook();
  const phone = usePhone();

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

  return (
    <div
      className="min-h-dvh md:flex"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
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
            <Link
              key={item.to}
              to={item.to}
              className="block rounded-lg px-3 py-2 text-sm text-[var(--ph-ink-2)] hover:bg-[var(--ph-fill)]"
              activeProps={{ className: 'bg-[var(--ph-fill)] font-medium text-[var(--ph-ink)]' }}
            >
              {item.label}
            </Link>
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
      {/* The phone draws under the status bar and the home indicator, so the shell gives both back. */}
      <main className="flex-1 pb-32 md:pb-8" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto max-w-4xl p-4 md:p-8">
          <InstallHint />
          {/* What just happened to their data comes before the standing reminder about backing it up. */}
          <AfterUpdateCard />
          <BackupBanner />
          <Outlet />
        </div>
      </main>
      {phone && (
        <>
          <TabBar onAdd={() => setAdding(true)} onAccount={() => setMore(true)} accountOpen={more} />
          {more && <AccountSheet onClose={() => setMore(false)} />}
          {adding && (
            <Sheet grouped title="Add a transaction" onClose={() => setAdding(false)}>
              <TransactionCard onDone={() => setAdding(false)} />
            </Sheet>
          )}
        </>
      )}
    </div>
  );
}
