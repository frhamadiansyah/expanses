import { formatMinor, parseMajor } from '@expanses/core';
import { ownerScope, saveSharedItem, type SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SubmitRow, TextRow } from '../../ui/native';
import { buyTarget } from './buy-item';
import { useSharedEventPlan } from './shared-queries';

/** The shared plan (D7): what the trip means to buy, in the event currency; Buy it now opens the Add screen on the item. */
export function SharedPlanTab({ view }: { view: SharedEventView }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useSharedEventPlan(view.eventId).data;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const items = (plan?.lines ?? []).flatMap((line) => line.items);

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await saveSharedItem(database, ownerScope(ws), view.eventId, { name, quantity: 1, unitPriceMinor: parseMajor(price, view.currency), categoryId: null, link: null, note: null });
      setName('');
      setPrice('');
      await invalidate();
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <>
      <InsetGroup header="To buy">
        {items.map((item) => (
          <InsetRow
            key={item.id}
            title={item.name}
            subtitle={item.bought ? `Bought · ${formatMinor(item.actualMinor ?? 0, view.currency)}` : `${item.quantity} × ${formatMinor(item.unitPriceMinor, view.currency)}`}
            value={formatMinor(item.estimateMinor, view.currency)}
            onClick={item.bought || view.finishedAt ? undefined : () => void navigate(buyTarget(view.eventId, item.id))}
            label={item.bought ? item.name : `Buy ${item.name} now`}
            testId="shared-plan-item"
          />
        ))}
      </InsetGroup>
      {view.finishedAt ? null : (
        <form aria-label="Add to the plan" onSubmit={(event) => void add(event)}>
          <InsetGroup>
            <TextRow label="Thing to buy" value={name} onChange={(e) => setName(e.target.value)} />
            <TextRow label={`Price (${view.currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            <SubmitRow label="Add to the plan" disabled={!name.trim() || !price.trim()} />
          </InsetGroup>
          <ErrorBox error={error} />
        </form>
      )}
    </>
  );
}
