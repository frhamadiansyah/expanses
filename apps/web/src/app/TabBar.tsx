import { Link, useRouterState } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { tapLight } from '../native/haptics';
import { AddMenu } from './AddMenu';
import { ACCOUNT_TAB, TABS } from './nav';

/** How long a finger rests on ＋ before the press is a hold, and the menu of other ways in opens. */
const HOLD_MS = 400;

/**
 * The phone's tab bar: a capsule floating over the page rather than a strip welded to its foot.
 *
 * Icons alone, evenly spaced, names carried for screen readers rather than printed. The tab you are on
 * wears a filled pill behind its icon. The + is a filled ink circle: recording a purchase is the
 * commonest thing done here, so the thumb finds it without looking, and everything else on the bar stays quiet.
 *
 * A plain tap on + opens the Add form, as it always has. Held, it opens a small menu instead (`AddMenu`): One line,
 * Paste a list, Scan a receipt, and the Add form again.
 */
export function TabBar({ onAdd }: { onAdd: () => void }) {
  /*
   * The shell's own chrome, in the app's own colours: the capsule is the kit's surface at 80%, so a phone on a
   * black page gets a black bar and the same bar it always had on a white one. `--ph-fill` behind the tab you are
   * on is the kit's grey, which is the same grey a group's rows take in either mode.
   */
  const cell = 'flex h-12 flex-1 items-center justify-center rounded-full text-[var(--ph-ink-3)] transition-colors';
  const here = 'bg-[var(--ph-fill)] text-[var(--ph-ink)]';
  /*
   * Trade is opened from Net worth's corner, as `/transactions/new?mode=trade`. That address is not Cashflow's page, but
   * the router reads it as under `/transactions`, so the bar is told: Net worth stays the tab on, the tab it came from.
   */
  const trading = useRouterState({ select: (s) => s.location.pathname === '/transactions/new' && (s.location.search as { mode?: string }).mode === 'trade' });
  const tabProps = (to: string) =>
    to === '/net-worth' && trading
      ? { className: `${cell} ${here}`, 'aria-current': 'page' as const }
      : to === '/transactions' && trading
        ? { className: cell, activeOptions: { exact: true }, activeProps: { className: here, 'aria-current': 'page' as const } }
        : { className: cell, activeProps: { className: here, 'aria-current': 'page' as const } };
  const [menuOpen, setMenuOpen] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click a finger's release sends after a hold has opened the menu: it is the hold's, not a tap.
  const swallowClick = useRef(false);
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const openMenu = () => {
    swallowClick.current = true;
    setMenuOpen(true);
  };
  useEffect(() => stopHold, []);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <nav
        aria-label="Main"
        className="pointer-events-auto flex w-full max-w-md items-center gap-1 rounded-full border border-[var(--ph-hair)] bg-[var(--ph-chrome)] p-1.5 shadow-lg shadow-black/10 backdrop-blur-xl"
      >
        {TABS.slice(0, 2).map((tab) => (
          <Link key={tab.to} to={tab.to} aria-label={tab.label} {...tabProps(tab.to)}>
            <tab.icon size={24} strokeWidth={1.9} aria-hidden />
          </Link>
        ))}
        <button
          type="button"
          aria-label="Add a transaction"
          className={`${cell} select-none`}
          style={{ WebkitTouchCallout: 'none' }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            // A new press starts clean: a hold whose release sent no click leaves nothing behind for this one.
            swallowClick.current = false;
            stopHold();
            holdTimer.current = setTimeout(() => {
              holdTimer.current = null;
              tapLight();
              openMenu();
            }, HOLD_MS);
          }}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onPointerLeave={stopHold}
          // A long press the system reads as its own (a mouse's right button, a browser's long-press menu) opens it too.
          onContextMenu={(event) => {
            event.preventDefault();
            stopHold();
            openMenu();
          }}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            onAdd();
          }}
        >
          <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-[var(--ph-ink)] text-[var(--ph-surface)]">
            <Plus size={20} strokeWidth={2.4} />
          </span>
        </button>
        {TABS.slice(2).map((tab) => (
          <Link key={tab.to} to={tab.to} aria-label={tab.label} {...tabProps(tab.to)}>
            <tab.icon size={24} strokeWidth={1.9} aria-hidden />
          </Link>
        ))}
        <Link to={ACCOUNT_TAB.to} className={cell} aria-label={ACCOUNT_TAB.label} activeProps={{ className: here, 'aria-current': 'page' }}>
          <ACCOUNT_TAB.icon size={24} strokeWidth={1.9} aria-hidden />
        </Link>
      </nav>
      {menuOpen && <AddMenu onClose={() => setMenuOpen(false)} onAdd={onAdd} />}
    </div>
  );
}
