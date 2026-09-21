import { isoDate } from '@expanses/core';
import { type EventRow, saveEvent } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarRange, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import {
  type GroupChild,
  InsetGroup,
  InsetRow,
  LargeTitle,
  ProgressBar,
  ROW_ICON,
  ROW_PAD_X,
  ROW_PAD_Y,
  rowHeight,
  SCREEN,
  SelectRow,
  SubmitRow,
  TextRow,
} from '../../ui/native';
import { useCategorySets } from '../categories/set-queries';
import { eventListLine } from './plan-view';
import { useEventPlan, useEvents } from './queries';

/** "13 – 17 Aug 2026", or one date when the event is a single day. */
export function eventDates(event: Pick<EventRow, 'startsOn' | 'endsOn'>): string {
  const day = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  if (event.startsOn === event.endsOn) return day(event.startsOn, true);
  return `${day(event.startsOn, false)} – ${day(event.endsOn, true)}`;
}

/** Where an event stands, in the words its card and its screen both use. */
export function eventStatus(event: Pick<EventRow, 'startsOn' | 'endsOn' | 'finishedAt'>, today: string): 'Upcoming' | 'Now' | 'Done' {
  if (event.finishedAt !== null || event.endsOn < today) return 'Done';
  return event.startsOn > today ? 'Upcoming' : 'Now';
}

export function StatusChip({ status }: { status: 'Upcoming' | 'Now' | 'Done' }) {
  return (
    <span
      className={cx(
        'rounded-full px-1.5 py-px text-[10.5px] font-bold tracking-wide uppercase',
        // The kit's panel pairs, so a chip keeps its meaning on a dark ground rather than turning into a pale smear.
        status === 'Now'
          ? 'bg-[var(--ph-tint-panel)] text-[var(--ph-tint-ink)]'
          : status === 'Upcoming'
            ? 'bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]'
            : 'bg-[var(--ph-fill)] text-[var(--ph-ink-3)]',
      )}
    >
      {status}
    </span>
  );
}

/**
 * One event as a card: what it is still to buy, what it has spent against the plan, and a thin bar when it has one.
 *
 * Every word and every figure is `eventListLine`'s — the same reading the event's own screens use, so a card and the
 * page it opens can never disagree. No items is no plan at all, not a plan of nought: such an event says what it
 * cost, says "spent", and is measured against nothing, because there is nothing to measure it against.
 */
function EventListRow({ event, today, position }: GroupChild & { event: EventRow; today: string }) {
  const { ws } = useApp();
  const plan = useEventPlan(event.id).data;
  const line = plan ? eventListLine(plan, ws.baseCurrency) : null;
  const of = line?.ofMinor ?? null;
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 right-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + ROW_ICON + 10 }} />
      )}
      {/* The kit's row, with room for the lines an event carries: the dates and where it stands, what the plan still
          wants, what came back — each its own line rather than one truncated subtitle, since every one is a figure. */}
      <Link
        to="/events/$eventId"
        params={{ eventId: event.id }}
        className="ph-focus-inset block w-full"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
        data-testid="event-row"
      >
        <span className="flex w-full items-center gap-[10px]">
          <span
            aria-hidden
            className="flex shrink-0 items-center justify-center rounded-full bg-[var(--ph-info-panel)] text-[var(--ph-info-ink)]"
            style={{ width: ROW_ICON, height: ROW_ICON }}
          >
            <CalendarRange size={15} strokeWidth={2.2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{event.name}</span>
            <span className="mt-[2px] flex items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              <span className="truncate">{eventDates(event)}</span>
              <StatusChip status={eventStatus(event, today)} />
            </span>
            {line && <span className="block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{line.subline}</span>}
            {/* The figure on the right is clamped at nought, so what the clamp swallowed is said here rather than
                left as a silent nought — the same both-sided rule the event's own screens keep under their ring. */}
            {line?.backLine && <span className="block truncate text-[12.5px] leading-[16px] text-[var(--ph-tint)]">{line.backLine}</span>}
          </span>
          {line && (
            <span className="tabular shrink-0 text-right">
              <Money minor={line.amountMinor} currency={ws.baseCurrency} className="block text-[15px] leading-[20px] text-[var(--ph-ink)]" />
              <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                {of === null ? 'spent' : <>of <Money minor={of} currency={ws.baseCurrency} /></>}
              </span>
            </span>
          )}
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
        </span>
        {/* A plan can add up to nought — a list of things each priced at nothing — and nothing is not a bar that is
            full. The kit's bar reads the fraction itself and never divides by nought; the figure arrives clamped
            from `eventListLine`, so this screen has no clamp of its own to remember. */}
        {plan?.hasPlan && line && (
          <span className="mt-[8px] block" style={{ marginLeft: ROW_ICON + 10, marginRight: 16 }}>
            <ProgressBar currentMinor={line.amountMinor} targetMinor={of ?? 0} label={`${event.name} against its plan`} />
          </span>
        )}
      </Link>
    </div>
  );
}

/**
 * Events: a birth, a wedding, a renovation, a trip, Lebaran.
 *
 * Spending on an event lands across many categories and a few weeks, so no monthly line ever sees the whole of it.
 * Each event is read on its own screen, built like Cashflow; this one lists them, the running ones first.
 */
export function EventsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const today = isoDate();
  const phone = usePhone();
  const [error, setError] = useState<unknown>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [setId, setSetId] = useState('');

  const all = events.data ?? [];
  const current = all.filter((event) => eventStatus(event, today) !== 'Done');
  // The most recent first: last month's trip is what is looked back on, not the one from years ago.
  const past = all.filter((event) => eventStatus(event, today) === 'Done').reverse();

  async function addEvent(submitted: FormEvent) {
    submitted.preventDefault();
    setError(null);
    try {
      const id = await saveEvent(database, ws, {
        name,
        startsOn,
        endsOn,
        setId: setId === '' ? null : setId,
      });
      await invalidate();
      // A new event is planned next, and that happens on its own screen.
      await navigate({ to: '/events/$eventId', params: { eventId: id } });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className={SCREEN}>
      <LargeTitle
        title="Events"
        // The same glyph at every width, under the name each width has always announced: a phone's "New event",
        // a desktop's "Add an event".
        actions={[{ key: 'new', label: phone ? 'New event' : 'Add an event', glyph: <Plus size={22} aria-hidden />, run: () => setAdding(true) }]}
      />
      <ErrorBox error={error ?? events.error} />

      {adding && (
        <form onSubmit={addEvent}>
          <InsetGroup header="New event">
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lebaran, the wedding, the renovation" />
            <SelectRow label="Categories" hint="A set keeps an event's categories out of your monthly tree." value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">The monthly categories</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </SelectRow>
            <TextRow label="Starts on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            <TextRow label="Ends on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </InsetGroup>
          <InsetGroup>
            <SubmitRow label="Save event" />
            <InsetRow title={<span className="font-normal text-[var(--ph-ink-2)]">Cancel</span>} label="Cancel" onClick={() => setAdding(false)} chevron={false} />
          </InsetGroup>
        </form>
      )}

      {events.isSuccess && all.length === 0 && !adding && (
        <Empty>No events yet. A birth, a wedding, a renovation, a trip — anything that spends across categories.</Empty>
      )}

      {current.length > 0 && (
        <InsetGroup header="Now and next">
          {current.map((event) => (
            <EventListRow key={event.id} event={event} today={today} />
          ))}
        </InsetGroup>
      )}
      {past.length > 0 && (
        <InsetGroup header="Past">
          {past.map((event) => (
            <EventListRow key={event.id} event={event} today={today} />
          ))}
        </InsetGroup>
      )}
    </div>
  );
}
