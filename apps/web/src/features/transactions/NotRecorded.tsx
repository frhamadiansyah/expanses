import { type DraftRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Money } from '../../ui';
import { useBillMoney } from '../bills/queries';
import { notRecordedTotal } from './not-recorded';

/**
 * Captured spending that has not reached the accounts yet, as one line in the box above the transactions — the
 * sibling of the Recurring bills row, and the door to Review from the page the drafts will land on.
 *
 * The drafts are the page's own: `TransactionsPage` narrows the queue to the account or category the page is open
 * for, and hands the very same list here that the Not recorded filter carries, so the row, the filter and the
 * screen behind it never disagree. It hides at nothing, the way Recurring hides with no bills.
 *
 * The figure is what those drafts add up to — what recording them would spend. It is approximate (`~`) when a
 * draft in another currency was converted at a stored rate, and it is not published at all while a rate is
 * missing: half a sum in the wrong money is worse than none. Nothing here is in the ledger yet; this is the
 * promise of what is waiting, not a posting.
 */
export function NotRecorded({ drafts }: { drafts: readonly DraftRow[] }) {
  // The money that converts a foreign figure even where the workspace reads in the owner's own currency.
  const money = useBillMoney();
  if (drafts.length === 0) return null;

  const read = money.data;
  const total = read ? notRecordedTotal(drafts, read) : null;

  return (
    <Link to="/review" search={{ from: 'cashflow' }} className="flex w-full items-center gap-3 py-3 text-left" data-testid="not-recorded-card">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]">
        <CircleAlert size={18} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Review transactions</span>
        <span className="block truncate text-xs text-slate-500">{drafts.length} not recorded</span>
      </span>
      {read && total && total.minor > 0 && (
        <span className="shrink-0 text-sm font-semibold">
          {total.approximate && '~'}
          <Money minor={total.minor} currency={read.currency} />
        </span>
      )}
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
    </Link>
  );
}
