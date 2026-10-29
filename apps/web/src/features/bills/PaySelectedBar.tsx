import { Ellipsis, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

/**
 * Select mode on Recurring, drawn as Cashflow's is: ✕ on the left to leave select mode, how many are selected in the
 * middle, and a ⋯ on the right whose menu holds the action. Nothing is laid over the foot of the screen.
 */
export function PaySelectedBar({ count, pay, onPay, onCancel }: { count: number; pay: ReactNode; onPay: () => void; onCancel: () => void }) {
  const [menu, setMenu] = useState(false);
  const circle = 'ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-surface)] shadow-[0_1px_3px_rgb(0_0_0/0.08)]';
  return (
    <div role="toolbar" aria-label="Selected bills" data-testid="select-bar" className="fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)]">
      <div aria-hidden className="ph-edge-glass pointer-events-none absolute inset-x-0 top-0 -bottom-5" />
      <div className="relative mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
        <button type="button" aria-label="Cancel selection" onClick={onCancel} className={`${circle} text-[var(--ph-ink-2)]`}>
          <X size={19} aria-hidden />
        </button>
        <span role="heading" aria-level={2} aria-label={`${count} selected`} aria-live="polite" className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-[var(--ph-ink)]">
          {count === 0 ? 'None selected' : `${count} selected`}
        </span>
        <button type="button" aria-label="Actions" aria-expanded={menu} onClick={() => setMenu((open) => !open)} className={`${circle} text-[var(--ph-tint)]`}>
          <Ellipsis size={22} aria-hidden />
        </button>
        {menu && (
          <div role="menu" aria-label="Actions" className="absolute top-full right-4 w-64 overflow-hidden rounded-[13px] bg-[var(--ph-surface)] text-[16px] shadow-[0_10px_34px_rgb(0_0_0/0.22)]">
            <button
              type="button"
              role="menuitem"
              disabled={count === 0}
              onClick={() => {
                setMenu(false);
                onPay();
              }}
              className="ph-focus-inset flex w-full items-center justify-between gap-3 px-4 py-[11px] text-left text-[var(--ph-ink)] disabled:text-[var(--ph-ink-3)]"
            >
              {pay}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
