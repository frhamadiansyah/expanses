import { formatMinor } from '@expanses/core';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { PayLink } from './PayLink';
import { useDueRow } from './queries';

/**
 * Cashflow's line for what is late or due within three days (spec §4.6): the most urgent instalment, statement or bill,
 * what else is waiting, and one tap to its own pay sheet. Drawn like the Recurring and Not recorded lines beside it;
 * nothing when nothing qualifies.
 */
export function DueRow() {
  const row = useDueRow();
  if (!row || !row.item.pay) return null;
  const { item } = row;
  return (
    <PayLink target={item.pay!} className="flex w-full items-center gap-3 py-3 text-left" testId="due-row">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${row.tone === 'alarm' ? 'bg-[var(--ph-alarm-panel)] text-[var(--ph-alarm)]' : 'bg-[var(--ph-warn-panel)] text-[var(--ph-warn-ink)]'}`}
      >
        <CircleAlert size={18} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{row.title}</span>
        <span className={`block truncate text-xs ${row.tone === 'alarm' ? 'text-[var(--ph-alarm)]' : 'text-slate-500'}`}>{row.subtitle}</span>
      </span>
      {item.minor !== null && <span className="tabular shrink-0 text-sm font-semibold">{formatMinor(item.minor, item.currency)}</span>}
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
    </PayLink>
  );
}
