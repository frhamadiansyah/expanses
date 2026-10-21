import { formatMinor, parseMajor } from '@expanses/core';
import { ownerScope, saveSharedItem, type SharedEventView } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SubmitRow, TextRow } from '../../ui/native';
import { buyTarget } from './buy-item';
import { SharedItemSheet } from './SharedItemSheet';
import { useSharedEventPlan } from './shared-queries';
import { type SharedPlanItem } from './shared-plan';
import { pageLocks } from './shared-view';

/**
 * The shared plan (D7): what the trip means to buy, in the event currency. A tap on an item opens it — its name and
 * price, what bought it (the tick), Buy it now, and Remove — so a mistyped price or an item bought without Buy it now
 * is put right on every phone (I10).
 */
export function SharedPlanTab({ view }: { view: SharedEventView }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const plan = useSharedEventPlan(view.eventId);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [opened, setOpened] = useState<SharedPlanItem | null>(null);
  const items = (plan.data?.lines ?? []).flatMap((line) => line.items);
  const { locked } = pageLocks(view);

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
      <ErrorBox error={plan.error} />
      <InsetGroup header="To buy">
        {items.map((item) => (
          <InsetRow
            key={item.id}
            title={item.name}
            subtitle={
              item.bought
                ? `Bought · ${formatMinor(item.actualMinor ?? 0, view.currency)}`
                : item.purchaseCount > 0
                  ? // Paid towards and still open: what was paid against what was planned, and how many payments made it.
                    `${formatMinor(item.actualMinor ?? 0, view.currency)} of ${formatMinor(item.estimateMinor, view.currency)} · ${item.purchaseCount} ${item.purchaseCount === 1 ? 'purchase' : 'purchases'}`
                  : `${item.quantity} × ${formatMinor(item.unitPriceMinor, view.currency)}`
            }
            value={formatMinor(item.estimateMinor, view.currency)}
            onClick={locked ? undefined : () => setOpened(item)}
            label={item.name}
            testId="shared-plan-item"
          />
        ))}
      </InsetGroup>
      {locked ? null : (
        <form aria-label="Add to the plan" onSubmit={(event) => void add(event)}>
          <InsetGroup>
            <TextRow label="Thing to buy" value={name} onChange={(e) => setName(e.target.value)} />
            <TextRow label={`Price (${view.currency})`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            <SubmitRow label="Add to the plan" disabled={!name.trim() || !price.trim()} />
          </InsetGroup>
          <ErrorBox error={error} />
        </form>
      )}
      {opened ? (
        <SharedItemSheet
          view={view}
          item={opened}
          onBuy={() => {
            setOpened(null);
            void navigate(buyTarget(view.eventId, opened.id));
          }}
          onClose={() => setOpened(null)}
        />
      ) : null}
    </>
  );
}
