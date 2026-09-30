import { Link } from '@tanstack/react-router';
import { Plus, UserRound } from 'lucide-react';
import { cx } from '../ui';
import { TABS } from './nav';

/**
 * The phone's tab bar: a capsule floating over the page rather than a strip welded to its foot.
 *
 * Icons alone, evenly spaced, names carried for screen readers rather than printed. The tab you are on
 * wears a filled pill behind its icon. The + is a filled circle in the app's green: recording a purchase is the
 * commonest thing done here, so the thumb finds it without looking, and everything else on the bar stays quiet.
 */
export function TabBar({ onAdd, onAccount, accountOpen }: { onAdd: () => void; onAccount: () => void; accountOpen: boolean }) {
  /*
   * The shell's own chrome, in the app's own colours: the capsule is the kit's surface at 80%, so a phone on a
   * black page gets a black bar and the same bar it always had on a white one. `--ph-fill` behind the tab you are
   * on is the kit's grey, which is the same grey a group's rows take in either mode.
   */
  const cell = 'flex h-12 flex-1 items-center justify-center rounded-full text-[var(--ph-ink-3)] transition-colors';
  const here = 'bg-[var(--ph-fill)] text-[var(--ph-ink)]';
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3 md:hidden"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <nav
        aria-label="Main"
        className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full border border-[var(--ph-hair)] bg-[var(--ph-chrome)] p-1.5 shadow-lg shadow-black/10 backdrop-blur-xl"
      >
        {TABS.slice(0, 2).map((tab) => (
          <Link key={tab.to} to={tab.to} className={cell} aria-label={tab.label} activeProps={{ className: here, 'aria-current': 'page' }}>
            <tab.icon size={24} strokeWidth={1.9} aria-hidden />
          </Link>
        ))}
        <button type="button" onClick={onAdd} aria-label="Add a transaction" className={cell}>
          <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-[var(--ph-tint)] text-white">
            <Plus size={20} strokeWidth={2.4} />
          </span>
        </button>
        {TABS.slice(2).map((tab) => (
          <Link key={tab.to} to={tab.to} className={cell} aria-label={tab.label} activeProps={{ className: here, 'aria-current': 'page' }}>
            <tab.icon size={24} strokeWidth={1.9} aria-hidden />
          </Link>
        ))}
        <button type="button" onClick={onAccount} aria-expanded={accountOpen} aria-label="Account" className={cx(cell, accountOpen && here)}>
          <UserRound size={24} strokeWidth={1.9} aria-hidden />
        </button>
      </nav>
    </div>
  );
}
