import { type CreatedInvite, type EventRow, type MoveRefusal } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, SubmitRow, TextRow } from '../../ui/native';
import { CurrencySheet } from '../currency/CurrencySheet';
import { InviteCard } from '../sharing/InviteCard';
import { freshShare, shareEventFooter } from './share-event';
import { useShareEventNow } from './share-event-now';
import { sayError } from '../sharing/sharing-copy';

/**
 * Sharing an existing event (shared events §6): asked once, here. The event becomes a shared one in its currency; what
 * is tagged to it moves out of its workspace and becomes this person's own expenses in it, its category set becomes
 * the event's categories and its plan the shared plan. The rates every move needs are fetched first.
 */
export function ShareEventSheet({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const { ws } = useApp();
  const invalidate = useInvalidateAll();
  const shareNow = useShareEventNow();
  // Kept across taps and retries (`runShare`): the event is shared once and moved once however the sheet is used.
  const progress = useRef(freshShare());
  const tapped = useRef(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [pickingCurrency, setPickingCurrency] = useState(false);
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<{ invite: CreatedInvite; kept: MoveRefusal[] } | null>(null);

  async function share(e: FormEvent) {
    e.preventDefault();
    // The tap itself is guarded too, not only the steps: the rate lookups before them take a while and a second tap
    // there would otherwise start a second run.
    if (tapped.current) return;
    tapped.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await shareNow({ eventId: event.id, currency, personName: name, names: names.split(',') }, progress.current);
      if (result) setDone(result);
      await invalidate();
    } catch (failure) {
      setError(sayError(failure));
    } finally {
      tapped.current = false;
      setBusy(false);
    }
  }

  return (
    <>
    <Sheet grouped title={`Share ${event.name}`} onClose={onClose}>
      <ErrorBox error={error} />
      {done ? (
        <>
          <InviteCard invite={done.invite} kind="event" bookName={event.name} inviterName={name} header={`Invite to ${event.name}`} footer="Send it to the people joining." />
          {done.kept.length > 0 ? (
            <InsetGroup header="Stayed where they were">
              {done.kept.map((k) => (
                <InsetRow key={k.transactionId} title={k.why} chevron={false} />
              ))}
            </InsetGroup>
          ) : null}
        </>
      ) : (
        <form aria-label="Share this event" onSubmit={(e) => void share(e)}>
          <InsetGroup footer={shareEventFooter(event.name)}>
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As the others will see it" required />
            <PickerRow label="Currency" value={currency} onOpen={() => setPickingCurrency(true)} />
            <TextRow label="Without the app" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Names, with commas" />
          </InsetGroup>
          <InsetGroup>
            <SubmitRow label={busy ? 'Sharing…' : 'Share'} disabled={busy || !name.trim()} />
          </InsetGroup>
        </form>
      )}
    </Sheet>
      {pickingCurrency && <CurrencySheet value={currency} baseCurrency={ws.baseCurrency} onPick={setCurrency} onClose={() => setPickingCurrency(false)} />}
    </>
  );
}
