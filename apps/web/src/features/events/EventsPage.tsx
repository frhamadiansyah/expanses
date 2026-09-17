import { isoDate, parseMajor } from '@expanses/core';
import { type EventRow, saveEvent } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarRange, ChevronRight, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, Money, PageHeader, RoundButton, Select } from '../../ui';
import { useCategorySets } from '../categories/set-queries';
import { useEvents, useEventSheet } from './queries';

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
        status === 'Now' ? 'bg-emerald-100 text-emerald-800' : status === 'Upcoming' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-500',
      )}
    >
      {status}
    </span>
  );
}

/** One event as a card: what it cost against what it planned, and a thin bar when it planned anything. */
function EventCard({ event, today }: { event: EventRow; today: string }) {
  const { ws } = useApp();
  const sheet = useEventSheet(event.id).data;
  const planned = sheet?.plannedMinor ?? null;
  const spent = sheet?.actualMinor ?? 0;
  const over = planned !== null && spent > planned;
  return (
    <Link to="/events/$eventId" params={{ eventId: event.id }} className="block" data-testid="event-row">
      <Card>
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
            <CalendarRange size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{event.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              {eventDates(event)} <StatusChip status={eventStatus(event, today)} />
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Money minor={spent} currency={ws.baseCurrency} className="block text-sm font-semibold" />
            <span className="block text-xs text-slate-500">
              {planned === null ? 'no plan' : <>of <Money minor={planned} currency={ws.baseCurrency} /></>}
            </span>
          </span>
          <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
        </span>
        {planned !== null && (
          <span className="mt-2 mr-7 ml-12 block h-1 overflow-hidden rounded-full bg-slate-100">
            <span className={cx('block h-1 rounded-full', over ? 'bg-red-700' : 'bg-emerald-600')} style={{ width: `${Math.min(1, spent / planned) * 100}%` }} />
          </span>
        )}
      </Card>
    </Link>
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
  const sets = useCategorySets().data ?? [];
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [plannedTotal, setPlannedTotal] = useState('');
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
        plannedMinor: plannedTotal.trim() === '' ? null : parseMajor(plannedTotal, ws.baseCurrency),
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
    <div className="space-y-4">
      <PageHeader
        title="Events"
        controls={
          <RoundButton label="New event" onClick={() => setAdding(true)}>
            <Plus size={22} aria-hidden />
          </RoundButton>
        }
        action={!adding && <Button onClick={() => setAdding(true)}>Add an event</Button>}
      />
      <ErrorBox error={error ?? events.error} />

      {adding && (
        <Card>
          <form onSubmit={addEvent} className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lebaran, the wedding, the renovation" />
              </Field>
              <Field label="Planned total" hint="Optional. Leave it empty and the category figures add up instead.">
                <Input value={plannedTotal} onChange={(e) => setPlannedTotal(e.target.value)} inputMode="decimal" placeholder="20000000" />
              </Field>
              <Field label="Categories" hint="A set keeps an event's categories out of your monthly tree.">
                <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
                  <option value="">The monthly categories</option>
                  {sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Starts on">
                <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
              <Field label="Ends on">
                <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Save event</Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {events.isSuccess && all.length === 0 && !adding && (
        <Empty>No events yet. A birth, a wedding, a renovation, a trip — anything that spends across categories.</Empty>
      )}

      {current.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Now and next</h2>
          {current.map((event) => (
            <EventCard key={event.id} event={event} today={today} />
          ))}
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Past</h2>
          {past.map((event) => (
            <EventCard key={event.id} event={event} today={today} />
          ))}
        </section>
      )}
    </div>
  );
}
