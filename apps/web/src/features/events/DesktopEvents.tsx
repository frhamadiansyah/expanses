import { isoDate } from '@expanses/core';
import type { EventRow, SharedEventSummary } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { CalendarRange } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { DeskNotices } from '../../app/DeskNotices';
import { Sheet } from '../../app/Sheet';
import { cx, ErrorBox, Money } from '../../ui';
import { useOpenBookReadOnly } from '../sharing/queries';
import { eventDates } from './event-dates';
import { EventModeGroup } from './EventMode';
import { takesEventMode } from './event-mode';
import { barPercent, eventGroups, sharedChip } from './events-desk-model';
import { useNewEvent } from './NewEventFlow';
import { eventListLine } from './plan-view';
import { useEventPlan, useEvents } from './queries';
import { useSharedEventSummaries, useSharedEventView } from './shared-queries';
import { DeskBar, DeskTitle, PILL_BLUE } from '../../ui/desk';

export const PBTN = PILL_BLUE;
const SECTION_TITLE = 'pb-[8px] text-[11px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';
// Four cards a row in a 1280 window, more in a wider one; a card never stretches past its share of the row.
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[12px]';
const CARD = 'flex min-h-[150px] flex-col rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] px-[14px] py-[13px]';

/** The event's mark, as the phone's list draws it: the calendar in a tinted circle. */
export function EventMarkCircle({ size = 34 }: { size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]" style={{ width: size, height: size }}>
      <CalendarRange size={Math.round(size * 0.47)} strokeWidth={2.2} />
    </span>
  );
}

/** The thin green bar a planned event's card and its Plan box draw: spent against planned. */
export function PlanBar({ part, whole, label }: { part: number; whole: number; label: string }) {
  const percent = barPercent(part, whole);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-[6px] overflow-hidden rounded-full bg-[var(--ph-track)]">
      <div className="h-full rounded-full bg-[var(--ph-up)]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Events on a wide screen (Mac Events, option A, owner 2026-11-18): a title bar with ＋ New event, then the events as
 * cards in a grid — Now and next (closed by a dashed ＋ New event card), then Past, in the phone list's order. A card
 * says the event's dates and what it spent, or what it spent of its plan with a green bar, and Shared · the others'
 * names on a shared one; a click opens the event full width (a shared one its shared page). A right-click offers the
 * event's Event mode, as a hold does on the phone. Every figure is the phone list's own (`eventListLine`).
 */
export function DesktopEvents() {
  const events = useEvents();
  const summaryRead = useSharedEventSummaries();
  const summaries = summaryRead.data ?? {};
  const today = isoDate();
  const create = useNewEvent();
  const all = events.data ?? [];
  const { now, past } = eventGroups(all, today);
  const ready = !summaryRead.isPending;

  const cards = (list: readonly EventRow[]) => list.map((event) => <EventCard key={event.id} event={event} shared={summaries[event.id]} ready={ready} />);

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="events-page" data-desk="true">
      <DeskBar crumb="Events">
        <button type="button" className={PBTN} onClick={create.start}>
          <span aria-hidden>＋</span>New event
        </button>
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Events" />
      <div className="space-y-[18px] px-[32px] pt-[2px] pb-[32px]">
        <ErrorBox error={create.error ?? events.error} />
        {events.isSuccess && all.length === 0 && (
          <p className="text-[13px] text-[var(--ph-ink-3)]">No events yet. A birth, a wedding, a renovation, a trip — anything that spends across categories.</p>
        )}
        {(now.length > 0 || (events.isSuccess && all.length === 0)) && (
          <section aria-labelledby="events-now">
            <h2 id="events-now" className={SECTION_TITLE}>
              Now and next
            </h2>
            <div className={GRID}>
              {cards(now)}
              <NewEventCard onClick={create.start} />
            </div>
          </section>
        )}
        {past.length > 0 && (
          <section aria-labelledby="events-past">
            <h2 id="events-past" className={SECTION_TITLE}>
              Past
            </h2>
            <div className={GRID}>{cards(past)}</div>
          </section>
        )}
        {/* With nothing running, the dashed card still closes the page: a new event is always one click away. */}
        {now.length === 0 && past.length > 0 && (
          <div className={GRID}>
            <NewEventCard onClick={create.start} />
          </div>
        )}
      </div>
      {create.overlay}
    </div>
  );
}

/** The dashed card that closes Now and next. The title bar's button is the one a reader or a keyboard reaches. */
function NewEventCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      data-testid="new-event-card"
      onClick={onClick}
      className="flex min-h-[150px] items-center justify-center gap-[4px] rounded-[10px] border border-dashed border-[var(--ph-chevron)] text-[13px] text-[var(--mac-accent)] hover:bg-[var(--ph-surface)]"
    >
      <span>＋</span>New event
    </button>
  );
}

/**
 * One event's card. A private event reads its plan as the phone's row does (`eventListLine`): what it spent, or what its
 * planned categories spent of the plan, with the bar; a shared one what the trip spent in its own currency. Until the
 * shared events are known, a shared one is not yet told apart, so its local plan is not read meanwhile.
 */
function EventCard({ event, shared, ready }: { event: EventRow; shared: SharedEventSummary | undefined; ready: boolean }) {
  const { ws } = useApp();
  const plan = useEventPlan(shared || !ready ? null : event.id).data;
  const line = plan ? eventListLine(plan, ws.baseCurrency, event.planOff) : null;
  const spent = useSharedEventView(shared ? event.id : null).data;
  const readOnly = useOpenBookReadOnly();
  const offersMode = !readOnly && (!shared || (!!spent && takesEventMode(spent)));
  const [mode, setMode] = useState(false);

  let figure: ReactNode = null;
  if (shared && spent) {
    figure = (
      <span data-testid="event-shared-spent">
        <Money minor={spent.spentMinor} currency={spent.currency} className="font-semibold text-[var(--ph-ink)]" /> <span className="text-[var(--ph-ink-3)]">spent</span>
      </span>
    );
  } else if (line) {
    figure =
      line.ofMinor === null ? (
        <span>
          <Money minor={line.amountMinor} currency={ws.baseCurrency} className="font-semibold text-[var(--ph-ink)]" /> <span className="text-[var(--ph-ink-3)]">spent</span>
        </span>
      ) : (
        <span className="flex flex-wrap gap-x-[4px]">
          <Money minor={line.amountMinor} currency={ws.baseCurrency} className="font-semibold text-[var(--ph-ink)]" />
          <span className="text-[var(--ph-ink-3)]">
            of <Money minor={line.ofMinor} currency={ws.baseCurrency} />
          </span>
        </span>
      );
  }

  return (
    <>
      <Link
        to="/events/$eventId"
        params={{ eventId: event.id }}
        data-testid="event-row"
        className={cx(CARD, 'transition-shadow hover:shadow-[0_1px_6px_rgba(0,0,0,0.08)] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]')}
        onContextMenu={(e) => {
          if (!offersMode) return;
          e.preventDefault();
          setMode(true);
        }}
      >
        <span className="flex items-start justify-between gap-[8px]">
          <EventMarkCircle />
          {shared && (
            <span data-testid="event-shared-chip" className="max-w-[60%] truncate rounded-[5px] bg-[var(--ph-fill)] px-[6px] py-[1px] text-[11px] text-[var(--ph-ink-2)]">
              {sharedChip(shared)}
            </span>
          )}
        </span>
        <span className="mt-[10px] block truncate text-[14px] font-semibold text-[var(--ph-ink)]">{event.name}</span>
        <span className="block truncate text-[12px] text-[var(--ph-ink-3)]">{eventDates(event)}</span>
        <span className="flex-1" />
        {/* Never cut: a figure too long for the card goes on to a second line. */}
        <span className="mt-[12px] block text-[13px] tabular-nums">{figure}</span>
        {/* What the clamp on the figure swallowed, said rather than left as a silent nought (the phone row's line). */}
        {line?.backLine && <span className="block truncate text-[11.5px] text-[var(--ph-up)]">{line.backLine}</span>}
        {line && line.ofMinor !== null && (
          <span className="mt-[8px] block">
            <PlanBar part={line.amountMinor} whole={line.ofMinor} label={`${event.name} against its plan`} />
          </span>
        )}
      </Link>
      {mode && (
        <Sheet grouped title={event.name} onClose={() => setMode(false)}>
          <EventModeGroup event={event} />
        </Sheet>
      )}
    </>
  );
}
