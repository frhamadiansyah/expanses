import { ChevronRight, CircleHelp, X } from 'lucide-react';

/**
 * Transactions saved with "Choose later", as one line in the box above the history — beside the bills and the queue.
 * Tapping it narrows the list to them; choosing a category for one (its circle, or Edit) takes it off the count, and
 * the line goes when none are left.
 */
export function NeedsCategory({ count, active = false, onShow, onClear }: { count: number; active?: boolean; onShow: () => void; onClear: () => void }) {
  if (count === 0) return null;
  const face = (
    <>
      {/* Grey, as the box's other lines (To review, Recurring) draw their circles: the box is a list of things to look
          at, not a warning. The rows themselves keep their own mark. */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]">
        <CircleHelp size={18} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Uncategorised</span>
        <span className="block truncate text-xs text-slate-500">{count} {count === 1 ? 'needs' : 'need'} a category</span>
      </span>
    </>
  );
  // Shown, the line says so by its ✕ in place of the ›: no pill is added to the page, and the ✕ is the way back to all.
  if (active) {
    return (
      <div className="flex w-full items-center gap-3 py-3" data-testid="needs-category-card" data-active>
        {face}
        <button type="button" aria-label="Clear needs a category" onClick={onClear} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onShow} className="flex w-full items-center gap-3 py-3 text-left" data-testid="needs-category-card">
      {face}
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
    </button>
  );
}
