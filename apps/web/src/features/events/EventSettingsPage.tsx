import { canChangeEventCurrency, CURRENCIES, isoDate } from '@expanses/core';
import { deleteEvent, type EventRow, finishEvent, saveEvent, setEventPlanOff } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Tags } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SwitchRow, TextRow } from '../../ui/native';
import { useCategorySets } from '../categories/set-queries';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { ChoiceSheet } from '../transactions/ChoiceSheet';
import { DELETE_FOOTER, finishRow, MONEY_FOOTER, PLAN_FOOTER, shareFooter } from './event-settings';
import { InPlaceNameRow, SettingsActionGroup, SettingsPickerRow } from './EventSettingsRows';
import { useEventHistory, useEventPlan, useEvents } from './queries';
import { ShareEventSheet } from './ShareEventSheet';
import { useSharedEventSummaries } from './shared-queries';
import { useHousehold } from '../sharing/household';
import { ITEM_SHARE_COPY } from '../sharing/ShareWithHousehold';

const MONTHLY = 'The monthly categories';

/**
 * An event's settings: what the gear on the event page opens. One page with no edit mode — every row is changed where it
 * is and saved at once (owner-approved 2026-11-14). Grouped by what each part is about: the event (name, dates), its money
 * (currency, categories), what it shows (Plan), who sees it (Share), then Mark as done and Delete, each with its sentence.
 *
 * Only an event that is not shared reaches it; once sharing finishes the page hands back to the event, which is then the
 * shared page with its own menu.
 */
export function EventSettingsPage() {
  const { eventId } = useParams({ from: '/events/$eventId/settings' });
  const events = useEvents();
  const event = (events.data ?? []).find((row) => row.id === eventId) ?? null;

  if (events.isSuccess && !event) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Settings" back="Events" backTo="/events" />
        <Empty>That event is no longer here.</Empty>
      </div>
    );
  }
  return (
    <div className={SCREEN} data-testid="event-settings">
      <PushedTitle title="Settings" back={event?.name ?? 'Back to the event'} backTo="/events/$eventId" backParams={{ eventId }} />
      <ErrorBox error={events.error} />
      {/* Mounted once the event is read, so the rows start from what is saved. */}
      {event && <EventSettings event={event} />}
    </div>
  );
}

/** The fields one save writes, as last saved: a save carries every field, so each starts from the last one that held. */
type Saved = Pick<EventRow, 'name' | 'startsOn' | 'endsOn' | 'setId' | 'goalId'>;

function EventSettings({ event }: { event: EventRow }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useEventPlan(event.id, null);
  const history = useEventHistory(event.id, null);
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const summaries = useSharedEventSummaries();
  const household = useHousehold();
  const [sharing, setSharing] = useState(false);
  const [picking, setPicking] = useState<'currency' | 'categories' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [startsOn, setStartsOn] = useState(event.startsOn);
  const [endsOn, setEndsOn] = useState(event.endsOn);
  const saved = useRef<Saved>({ name: event.name, startsOn: event.startsOn, endsOn: event.endsOn, setId: event.setId, goalId: event.goalId });
  // One save at a time, in the order they were made: a name typed while a date is being written lands after it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const isShared = summaries.data?.[event.id] !== undefined;
  // Shared (here, or already on arrival): the event's own page is the place, and the sheet has said its piece.
  useEffect(() => {
    if (isShared && !sharing) void navigate({ to: '/events/$eventId', params: { eventId: event.id }, replace: true });
  }, [isShared, sharing, navigate, event.id]);

  function run(work: () => Promise<unknown>) {
    queue.current = queue.current.then(async () => {
      setError(null);
      try {
        await work();
        await invalidate();
      } catch (e) {
        setError(e);
      }
    });
  }

  /** Writes the event with these fields changed; refused (a backwards pair of dates, say), nothing is kept. */
  function save(patch: Partial<Saved> & { currency?: string }) {
    run(async () => {
      const { currency, ...fields } = patch;
      const next = { ...saved.current, ...fields };
      await saveEvent(database, ws, { id: event.id, ...next, ...(currency !== undefined ? { currency } : {}) });
      saved.current = next;
    });
  }

  // The same two locks the event page has always applied: nothing changes categories once money is tagged or an item
  // is planned, nor currency once something is bought. The repository refuses the currency change as well.
  const data = plan.data;
  const anyMoney = (data?.spentMinor ?? 0) !== 0;
  const hasItems = data?.hasPlan === true;
  const transactions = history.data?.length ?? 0;
  const setLocked = anyMoney || hasItems || transactions > 0;
  const currencyLocked = !canChangeEventCurrency((data?.lines ?? []).flatMap((line) => line.items).filter((item) => item.done || item.purchases.length > 0).length);
  const setName = sets.find((set) => set.id === event.setId)?.name ?? MONTHLY;
  const currency = event.currency ?? ws.baseCurrency;
  const currencyName = CURRENCIES.find((row) => row.code === currency)?.name ?? currency;
  const others = household.data?.others.map((other) => other.name) ?? [];
  const finish = finishRow(event, isoDate());

  return (
    <>
      <ErrorBox error={error ?? plan.error} />
      <InsetGroup header="Event">
        <InPlaceNameRow value={event.name} onCommit={(name) => save({ name })} testId="settings-name" />
        <TextRow
          label="Starts on"
          type="date"
          value={startsOn}
          data-testid="settings-starts"
          onChange={(e) => {
            setStartsOn(e.target.value);
            save({ startsOn: e.target.value, endsOn });
          }}
        />
        <TextRow
          label="Ends on"
          type="date"
          value={endsOn}
          data-testid="settings-ends"
          onChange={(e) => {
            setEndsOn(e.target.value);
            save({ startsOn, endsOn: e.target.value });
          }}
        />
      </InsetGroup>
      <InsetGroup header="Money" footer={MONEY_FOOTER}>
        <SettingsPickerRow title="Currency" value={currencyName} label={`Currency: ${currency}`} locked={currencyLocked} onOpen={() => setPicking('currency')} testId="settings-currency" />
        <SettingsPickerRow title="Categories" value={setName} locked={setLocked} onOpen={() => setPicking('categories')} testId="settings-categories" />
      </InsetGroup>
      <InsetGroup footer={PLAN_FOOTER}>
        <SwitchRow label="Plan" checked={!event.planOff} onChange={(on) => run(() => setEventPlanOff(database, ws, event.id, !on))} testId="settings-plan" />
      </InsetGroup>
      {/* The same "Shared with Andi" switch every item has (2026-11-13); on opens today's share sheet, with its code. */}
      {others.length > 0 ? (
        <InsetGroup footer={shareFooter(others)}>
          <SwitchRow label={ITEM_SHARE_COPY.shared(others)} checked={sharing} onChange={(on) => on && setSharing(true)} testId="settings-share" />
        </InsetGroup>
      ) : (
        <InsetGroup>
          <InsetRow title="Share this event" label="Share this event" onClick={() => setSharing(true)} action testId="settings-share" />
        </InsetGroup>
      )}
      <SettingsActionGroup label={finish.label} footer={finish.footer} testId="settings-done" onClick={() => run(() => finishEvent(database, ws, event.id, event.finishedAt === null))} />
      <SettingsActionGroup
        label="Delete event"
        destructive
        footer={DELETE_FOOTER}
        testId="settings-delete"
        onClick={() => {
          if (!window.confirm(`Remove ${event.name}? ${DELETE_FOOTER}`)) return;
          run(async () => {
            await deleteEvent(database, ws, event.id);
            await navigate({ to: '/events' });
          });
        }}
      />
      {picking === 'currency' && (
        <CurrencySheet value={currency} accountCurrency={currency} baseCurrency={ws.baseCurrency} onPick={(code) => code !== currency && save({ currency: code })} onClose={() => setPicking(null)} />
      )}
      {picking === 'categories' && (
        <ChoiceSheet
          title="Categories"
          value={event.setId ?? ''}
          groups={[{ choices: [{ value: '', label: MONTHLY, glyph: <Tags size={16} /> }, ...sets.map((set) => ({ value: set.id, label: set.name, glyph: <Tags size={16} /> }))] }]}
          onPick={(id) => {
            const setId = id === '' ? null : id;
            if (setId !== event.setId) save({ setId });
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {sharing ? <ShareEventSheet event={event} onClose={() => setSharing(false)} /> : null}
    </>
  );
}
