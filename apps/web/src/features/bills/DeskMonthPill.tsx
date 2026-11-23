import { ChevronLeft, ChevronRight } from 'lucide-react';

/*
 * v1's "‹ November 2026 ›" in a Mac title bar (Budget, Bills): one grey pill, the month between its two arrows. Kept with
 * the pages that draw it rather than in the shared kit (ui/desk.tsx), which this step does not change.
 */
export function DeskMonthPill({ label, onStep, testId }: { label: string; onStep: (by: -1 | 1) => void; testId?: string }) {
  const arrow = 'flex h-[28px] w-[24px] items-center justify-center rounded-full text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--mk-blue)]';
  return (
    <div className="inline-flex h-[34px] shrink-0 items-center rounded-full bg-[var(--mk-pill)] px-[4px] text-[13.5px] font-semibold text-[var(--mk-ink)]">
      <button type="button" aria-label="Previous month" onClick={() => onStep(-1)} className={arrow}>
        <ChevronLeft size={15} strokeWidth={2.4} aria-hidden />
      </button>
      <span data-testid={testId} className="px-[2px] whitespace-nowrap tabular-nums">
        {label}
      </span>
      <button type="button" aria-label="Next month" onClick={() => onStep(1)} className={arrow}>
        <ChevronRight size={15} strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}
