import { type DraftRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Card, Money } from '../../ui';
import { useBookMoney } from '../workspaces/queries';

/**
 * Captured spending that has not reached the accounts yet, as one line above the transactions — the sibling of the
 * Recurring bills row, and the door to Review from the page the drafts will land on.
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
  const money = useBookMoney();
  if (drafts.length === 0) return null;

  const read = money.data;
  const rows =
    read === undefined
      ? null
      : drafts.map((draft) => {
          const minor = Math.abs(draft.amountMinor);
          if (!read.converts || draft.currency === read.currency) return { minor, approximate: false };
          const converted = read.convert(minor, draft.currency, draft.occurredOn);
          return converted === null ? null : { minor: converted, approximate: true };
        });
  const held = rows === null || rows.some((row) => row === null);
  const total = (rows ?? []).reduce((sum, row) => sum + (row?.minor ?? 0), 0);
  const approximate = (rows ?? []).some((row) => row?.approximate);

  return (
    <Card>
      <Link to="/review" className="flex w-full items-center gap-3 text-left" data-testid="not-recorded-card">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-3)]">
          <CircleAlert size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Review transactions</span>
          <span className="block truncate text-xs text-slate-500">{drafts.length} not recorded</span>
        </span>
        {read && !held && total > 0 && (
          <span className="shrink-0 text-sm font-semibold">
            {approximate && '~'}
            <Money minor={total} currency={read.currency} />
          </span>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
      </Link>
    </Card>
  );
}
