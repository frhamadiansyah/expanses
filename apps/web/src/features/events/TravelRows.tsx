import { Link } from '@tanstack/react-router';
import { Plane } from 'lucide-react';
import { useApp } from '../../app/context';
import { Money } from '../../ui';
import { type GroupChild, InsetGroup, ROW_ICON, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import { eventListLine } from './plan-view';
import { useEventPlan, useEvents } from './queries';
import { useSharedEventSummaries, useSharedEventView } from './shared-queries';
import { type TravelEntry, travelEntries } from './travel-rows';

/** One trip as a row: the event, where it stands today, and what it has spent (against its plan when it has one). */
function TravelRow({ entry, shared, ready, position }: GroupChild & { entry: TravelEntry; shared: boolean; ready: boolean }) {
  const { ws } = useApp();
  const { event } = entry;
  const plan = useEventPlan(shared || !ready ? null : event.id).data;
  const line = plan ? eventListLine(plan, ws.baseCurrency, event.planOff) : null;
  const sharedView = useSharedEventView(shared ? event.id : null).data;
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + ROW_ICON + 10 }} />
      )}
      <Link
        to="/events/$eventId"
        params={{ eventId: event.id }}
        className="ph-focus-inset flex w-full items-center gap-[10px]"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
        data-testid="travel-row"
      >
        <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]" style={{ width: ROW_ICON, height: ROW_ICON }}>
          <Plane size={15} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{event.name}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{entry.line}</span>
        </span>
        {line && (
          <span className="tabular shrink-0 text-right">
            <Money minor={line.amountMinor} currency={ws.baseCurrency} className="block text-[15px] leading-[20px] text-[var(--ph-ink)]" />
            {line.ofMinor !== null && (
              <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                of <Money minor={line.ofMinor} currency={ws.baseCurrency} />
              </span>
            )}
          </span>
        )}
        {shared && sharedView && (
          <span className="tabular shrink-0 text-right">
            <Money minor={sharedView.spentMinor} currency={sharedView.currency} className="block text-[15px] leading-[20px] text-[var(--ph-ink)]" />
          </span>
        )}
        <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
          {'›'}
        </span>
      </Link>
    </div>
  );
}

/**
 * Cashflow's way into a trip: one row for each event running today or starting within a week (two at most). An entry
 * only: the trip's spending is not in the ring or the history around it.
 */
export function TravelRows({ today }: { today: string }) {
  const events = useEvents();
  const summaries = useSharedEventSummaries();
  const entries = travelEntries(events.data ?? [], today);
  if (entries.length === 0) return null;
  return (
    <div data-testid="travel-rows">
      <InsetGroup>
        {entries.map((entry) => (
          <TravelRow key={entry.event.id} entry={entry} shared={Boolean(summaries.data?.[entry.event.id])} ready={summaries.isSuccess} />
        ))}
      </InsetGroup>
    </div>
  );
}
