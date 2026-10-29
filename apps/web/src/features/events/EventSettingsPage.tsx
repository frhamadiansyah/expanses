import { canChangeEventCurrency } from '@expanses/core';
import { deleteEvent, finishEvent, setEventPlanOff } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, PushedTitle, SCREEN, SwitchRow } from '../../ui/native';
import { useCategorySets } from '../categories/set-queries';
import { EditEventForm } from './EditEventForm';
import { eventDates } from './EventsPage';
import { useEventHistory, useEventPlan, useEvents } from './queries';
import { ShareEventSheet } from './ShareEventSheet';
import { useSharedEventSummaries } from './shared-queries';

/**
 * An event's settings: what the gear on the event page opens. Name, dates, categories and currency as rows (a tap opens
 * the Edit event form, unchanged, in their place), Plan and Done as switches, Share, and Delete last, in a group of its own.
 *
 * Only an event that is not shared reaches it; once sharing finishes the page hands back to the event, which is then the
 * shared page with its own menu.
 */
export function EventSettingsPage() {
  const { eventId } = useParams({ from: '/events/$eventId/settings' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;
  const plan = useEventPlan(eventId, null);
  const history = useEventHistory(eventId, null);
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const summaries = useSharedEventSummaries();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isShared = summaries.data?.[eventId] !== undefined;
  // Shared (here, or already on arrival): the event's own page is the place, and the sheet has said its piece.
  useEffect(() => {
    if (isShared && !sharing) void navigate({ to: '/events/$eventId', params: { eventId }, replace: true });
  }, [isShared, sharing, navigate, eventId]);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const back = { back: 'Back to the event', backTo: '/events/$eventId', backParams: { eventId } } as const;
  if (events.isSuccess && !event) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Event settings" back="Events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </div>
    );
  }

  // The same two locks the event page has always applied to the form: nothing changes categories once money is
  // tagged or an item is planned, nor currency once something is bought.
  const data = plan.data;
  const anyMoney = (data?.spentMinor ?? 0) !== 0;
  const hasItems = data?.hasPlan === true;
  const transactions = history.data?.length ?? 0;
  const setLocked = anyMoney || hasItems || transactions > 0;
  const currencyLocked = !canChangeEventCurrency((data?.lines ?? []).flatMap((line) => line.items).filter((item) => item.done || item.purchases.length > 0).length);
  const setName = sets.find((set) => set.id === event?.setId)?.name ?? 'The monthly categories';
  const open = () => setEditing(true);

  return (
    <div className={SCREEN} data-testid="event-settings">
      <PushedTitle title="Event settings" {...back} />
      <ErrorBox error={error ?? events.error ?? plan.error} />
      {event && (
        <>
          {editing ? (
            <EditEventForm event={event} sets={sets} setLocked={setLocked} currencyLocked={currencyLocked} onDone={() => setEditing(false)} />
          ) : (
            <InsetGroup>
              <InsetRow title="Name" value={event.name} onClick={open} testId="settings-name" />
              <InsetRow title="Dates" value={eventDates(event)} onClick={open} testId="settings-dates" />
              <InsetRow title="Categories" value={setName} onClick={open} chevron={!setLocked} testId="settings-categories" />
              <InsetRow title="Currency" value={event.currency ?? ws.baseCurrency} onClick={open} chevron={!currencyLocked} testId="settings-currency" />
            </InsetGroup>
          )}
          <InsetGroup>
            <SwitchRow label="Plan" checked={!event.planOff} onChange={(on) => void run(() => setEventPlanOff(database, ws, event.id, !on))} testId="settings-plan" />
            <SwitchRow label="Done" checked={event.finishedAt !== null} onChange={(on) => void run(() => finishEvent(database, ws, event.id, on))} testId="settings-done" />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Share this event" label="Share this event" onClick={() => setSharing(true)} action testId="settings-share" />
          </InsetGroup>
          <InsetGroup>
            <DestructiveRow
              label="Delete event"
              testId="settings-delete"
              onClick={() => {
                if (!window.confirm(`Remove ${event.name}? Its transactions stay where they are.`)) return;
                void run(async () => {
                  await deleteEvent(database, ws, event.id);
                  await navigate({ to: '/events' });
                });
              }}
            />
          </InsetGroup>
        </>
      )}
      {sharing && event ? <ShareEventSheet event={event} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
