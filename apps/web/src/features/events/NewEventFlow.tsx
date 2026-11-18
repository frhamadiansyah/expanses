import { isoDate } from '@expanses/core';
import { saveEvent } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { AddWorkspaceSheet } from '../account/AddWorkspaceSheet';
import { useCategorySets } from '../categories/set-queries';
import { JoinSheet } from '../sharing/JoinSheet';
import { CurrencySheet } from '../transactions/CurrencySheet';
import { EventCurrencyRow } from './EventCurrencyRow';

/**
 * Making an event, from wherever it is offered — the Events list's ＋ (phone and Mac), the Mac cards page's dashed card
 * and an event's title menu: New event or Join with a code, then the New event sheet over the page. Saving opens the new
 * event, since planning it is what comes next. `start` opens the choice; `overlay` is drawn once by the page.
 */
export function useNewEvent(): { start: () => void; overlay: ReactNode; error: unknown } {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const sets = useCategorySets({ ownerWide: true }).data ?? [];
  const today = isoDate();
  const [error, setError] = useState<unknown>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [setId, setSetId] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [joining, setJoining] = useState(false);

  async function addEvent() {
    setError(null);
    try {
      const id = await saveEvent(database, ws, {
        name,
        startsOn,
        endsOn,
        setId: setId === '' ? null : setId,
        currency,
      });
      await invalidate();
      // A new event is planned next, and that happens on its own screen.
      await navigate({ to: '/events/$eventId', params: { eventId: id } });
    } catch (e) {
      setError(e);
    }
  }

  const overlay = (
    <>
      {choosing && (
        <AddWorkspaceSheet
          title="Events"
          newLabel="New event"
          testIds={{ sheet: 'add-event-sheet', news: 'new-event', join: 'join-event-choice' }}
          onNew={() => {
            setChoosing(false);
            setAdding(true);
          }}
          onJoin={() => {
            setChoosing(false);
            setJoining(true);
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {joining && <JoinSheet onClose={() => setJoining(false)} />}

      {/* A sheet over the list, as every other thing made from a list is: ✕ and ✓ in its header, the page behind it untouched. */}
      {adding && (
        <Sheet
          grouped
          tall
          title="New event"
          onClose={() => setAdding(false)}
          confirm={{ label: 'Save event', disabled: name.trim() === '', run: () => void addEvent() }}
        >
          <InsetGroup>
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <SelectRow label="Categories" value={setId} onChange={(e) => setSetId(e.target.value)}>
              <option value="">The monthly categories</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </SelectRow>
            <EventCurrencyRow value={currency} onOpen={() => setPicking(true)} />
            <TextRow label="Starts on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            <TextRow label="Ends on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </InsetGroup>
          {picking && <CurrencySheet value={currency} accountCurrency={currency} baseCurrency={ws.baseCurrency} onPick={setCurrency} onClose={() => setPicking(false)} />}
          <ErrorBox error={error} />
        </Sheet>
      )}
    </>
  );
  return { start: () => setChoosing(true), overlay, error };
}
