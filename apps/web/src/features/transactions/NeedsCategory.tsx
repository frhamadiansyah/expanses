import { ChevronRight, CircleHelp } from 'lucide-react';

/**
 * Transactions saved with "Choose later", as one line in the box above the history — beside the bills and the queue.
 * Tapping it narrows the list to them; choosing a category for one (its circle, or Edit) takes it off the count, and
 * the line goes when none are left.
 */
export function NeedsCategory({ count, onShow }: { count: number; onShow: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" onClick={onShow} className="flex w-full items-center gap-3 py-3 text-left" data-testid="needs-category-card">
      {/* The amber of a question still to answer: the same mark the rows themselves wear. */}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]">
        <CircleHelp size={18} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Uncategorised</span>
        <span className="block truncate text-xs text-slate-500">{count} {count === 1 ? 'needs' : 'need'} a category</span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
    </button>
  );
}
