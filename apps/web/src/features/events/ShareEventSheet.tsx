import { CURRENCIES } from '@expanses/core';
import { type CreatedInvite, type EventRow, type MoveRefusal, ownerScope } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { InviteCard } from '../sharing/InviteCard';
import { finishConversion, freshShare, markConversionDone, runShare } from './share-event';
import { conversionSteps, fetchConversionRates } from './shared-queries';
import { sayError } from '../sharing/sharing-copy';
import { thisDeviceName } from '../sharing/SharingSection';

/**
 * Sharing an existing event (shared events §6): asked once, here. The event becomes a shared one in its currency; what
 * is tagged to it moves out of its workspace and becomes this person's own expenses in it, its category set becomes
 * the event's categories and its plan the shared plan. The rates every move needs are fetched first.
 */
export function ShareEventSheet({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const { database, ws, sync } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  // Kept across taps and retries (`runShare`): the event is shared once and moved once however the sheet is used.
  const progress = useRef(freshShare());
  const tapped = useRef(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
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
      await fetchConversionRates(database, ws, event.id, currency, resolveRates);
      const result = await runShare(progress.current, {
        share: async () =>
          (
            await sync.shareEvent(ownerScope(ws), {
              eventId: event.id,
              currency,
              personName: name,
              deviceName: thisDeviceName(),
              names: names.split(',').map((n) => n.trim()).filter(Boolean),
            })
          ).bookId,
        // Safe to run again (I9): a retry after a conversion cut short part-way never copies the plan twice.
        convert: async () => {
          const kept = await finishConversion(conversionSteps(database, ws, event.id));
          markConversionDone(event.id);
          return kept;
        },
        invite: (bookId) => sync.eventInvite(bookId, name),
      });
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
    <Sheet grouped title={`Share ${event.name}`} onClose={onClose}>
      <ErrorBox error={error} />
      {done ? (
        <>
          <InviteCard invite={done.invite} bookName={event.name} inviterName={name} header={`Invite to ${event.name}`} footer="Send it to the people joining." />
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
          <InsetGroup footer={`Everyone in ${event.name} sees every expense of it, who paid and how it is split. What is tagged to it moves out of its workspace: in each person's own books only their own share counts.`}>
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="As the others will see it" required />
            <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </SelectRow>
            <TextRow label="Without the app" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Names, with commas" />
            <SubmitRow label={busy ? 'Sharing…' : 'Share'} disabled={busy || !name.trim()} />
          </InsetGroup>
        </form>
      )}
    </Sheet>
  );
}
