import { formatMinor } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { CalendarClock } from 'lucide-react';
import { GROUP_GAP, GROUP_RADIUS, PanelHeader, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import type { InstalmentLine } from './instalment-rows';

/**
 * The card instalment plans still running, read-only, after the month's bills. Drawn as a bill row is: a round icon, the
 * plan and its card with how far through it is under, the monthly figure at the right. A tap opens that card's
 * instalments. Paid with the card's statement, so it is in no total on this page.
 */
export function MonthlyInstalments({ lines }: { lines: readonly InstalmentLine[] }) {
  const navigate = useNavigate();
  if (lines.length === 0) return null;
  return (
    <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="monthly-instalments">
      <PanelHeader title="Instalments" />
      <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS, overflow: 'hidden' }}>
        {lines.map((line, index) => (
          <div key={line.id} data-testid="instalment-line" className="relative">
            {index > 0 && <span aria-hidden className="pointer-events-none absolute top-0 right-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
            <button
              type="button"
              onClick={() => void navigate({ to: '/cards/$cardId/settings/instalments', params: { cardId: line.cardId } })}
              className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
              style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
            >
              <span aria-hidden className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]">
                <CalendarClock size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{line.title}</span>
                <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{line.detail}</span>
              </span>
              <span className="tabular shrink-0 text-[15px] leading-[20px] text-[var(--ph-ink)]">{formatMinor(line.monthlyMinor, line.currency)}</span>
              <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)] md:hidden">
                {'›'}
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
