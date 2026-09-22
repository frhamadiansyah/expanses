import { Link } from '@tanstack/react-router';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Card } from '../../ui';

/**
 * Captured spending that has not reached the accounts yet, as one line above the transactions — the sibling of the
 * Recurring bills row, and the door to Review from the page the drafts will land on.
 *
 * The count is the page's own: `TransactionsPage` filters the queue to the account or category the page is opened
 * for, and hands the same number here that the Not recorded filter carries, so the row and the filter never
 * disagree. It hides at nothing, the way Recurring hides with no bills.
 */
export function NotRecorded({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Card>
      <Link to="/review" className="flex w-full items-center gap-3 text-left" data-testid="not-recorded-card">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <CircleAlert size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{count} not recorded</span>
          <span className="block truncate text-xs text-slate-500">Captured spending — check, then confirm</span>
        </span>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
      </Link>
    </Card>
  );
}
