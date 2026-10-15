import type { MoveRefusal, SharedEventView } from '@expanses/db';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow } from '../../ui/native';
import { useEvents } from './queries';
import { conversionDone, finishConversion, markConversionDone, needsFinishing } from './share-event';
import { conversionSteps, fetchConversionRates, useConversionLeft } from './shared-queries';

/**
 * "Finish sharing" (I9): sharing an event makes its relay book first and brings its own things in after. When the
 * second part was cut short — no rate for the event currency yet, the sheet closed, the app killed — the event is
 * shared while its purchases are still in their workspaces and its plan is not shared. Nothing else ever reaches that
 * step again, so the shared page offers it here, until it has run to the end once on this phone.
 */
export function FinishSharing({ view }: { view: SharedEventView }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const event = (useEvents().data ?? []).find((row) => row.id === view.eventId) ?? null;
  // Read on every render, not once: the share sheet over this page marks it done as its own conversion finishes.
  const [finishedHere, setFinishedHere] = useState(false);
  const converted = finishedHere || conversionDone(view.eventId);
  const left = useConversionLeft(view.eventId, event?.setId ?? null, !converted).data;
  // The tap is guarded as well as the button: the rate lookups take a while, and a second run must not start under them.
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [kept, setKept] = useState<MoveRefusal[] | null>(null);

  async function finish() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await fetchConversionRates(database, ws, view.eventId, view.currency, resolveRates);
      const out = await finishConversion(conversionSteps(database, ws, view.eventId));
      markConversionDone(view.eventId);
      setFinishedHere(true);
      setKept(out);
      await invalidate();
    } catch (failure) {
      setError(failure);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (kept && kept.length > 0) {
    return (
      <InsetGroup header="Stayed where they were" footer="These stay tagged in their workspace.">
        {kept.map((k) => (
          <InsetRow key={k.transactionId} title={k.why} chevron={false} />
        ))}
      </InsetGroup>
    );
  }
  if (converted || !left || !needsFinishing(left, false)) return null;
  return (
    <>
      <ErrorBox error={error} />
      <InsetGroup footer={`Sharing ${view.name} stopped part-way: what is tagged to it, its categories and its plan are not all in it yet.`}>
        <InsetRow title={busy ? 'Finishing…' : 'Finish sharing'} onClick={busy ? undefined : () => void finish()} testId="finish-sharing" />
      </InsetGroup>
    </>
  );
}
