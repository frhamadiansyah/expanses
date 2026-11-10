import { formatMinor, periodLabel, stepPeriod } from '@expanses/core';
import type { ReactNode } from 'react';

/**
 * Cashflow on a phone held sideways: the wide-screen table, full screen, under one slim bar with the month and what
 * it spent. The shell draws nothing of its own on this route sideways (no tab bar, no sidebar), so this layer is the
 * whole screen. It sits under the sheets (z-30) and the toasts (z-40), so a picker or a form opened from a row comes
 * up over the table rather than behind it.
 */
export function SidewaysTable({
  month,
  onMonth,
  spentMinor,
  currency,
  children,
}: {
  month: string;
  onMonth: (next: string) => void;
  spentMinor: number;
  currency: string;
  children: ReactNode;
}) {
  // Arrows step by whatever the period is; All time and two chosen dates have no neighbours.
  const before = stepPeriod(month, -1);
  const after = stepPeriod(month, 1);
  const arrow = 'flex size-9 items-center justify-center rounded-full text-xl leading-none text-slate-700 hover:bg-slate-100 disabled:opacity-30';
  return (
    <div
      data-testid="sideways-table"
      className="fixed inset-0 z-[25] overflow-auto bg-[var(--ph-ground)]"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <div data-testid="sideways-bar" className="flex items-center gap-2 px-3 py-1.5">
        <button type="button" aria-label="Previous month" disabled={!before} onClick={() => before && onMonth(before)} className={arrow}>
          <span aria-hidden>‹</span>
        </button>
        <span className="min-w-36 text-center text-sm font-semibold">{periodLabel(month)}</span>
        <button type="button" aria-label="Next month" disabled={!after} onClick={() => after && onMonth(after)} className={arrow}>
          <span aria-hidden>›</span>
        </button>
        <span className="ml-auto text-sm text-slate-500">
          <b className="tabular font-semibold text-slate-900">{formatMinor(spentMinor, currency)}</b> spent
        </span>
      </div>
      <div className="px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{children}</div>
    </div>
  );
}
