import { CURRENCIES } from '@expanses/core';
import { ownerScope, setSharedEventCurrency, type SharedEventView } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, SubmitRow } from '../../ui/native';

/** The event currency, until something is spent (D5): every figure on the event is in it. */
export function EventCurrencySheet({ view, onClose }: { view: SharedEventView; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [currency, setCurrency] = useState(view.currency);
  const [error, setError] = useState<unknown>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await setSharedEventCurrency(database, ownerScope(ws), view.eventId, currency);
      await invalidate();
      onClose();
    } catch (failure) {
      setError(failure);
    }
  }
  return (
    <Sheet grouped title="Currency" onClose={onClose}>
      <form aria-label="Event currency" onSubmit={(event) => void save(event)}>
        <InsetGroup footer={`Every figure on ${view.name} is shown in it. Fixed once something is spent.`}>
          <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </SelectRow>
          <SubmitRow label="Save" />
        </InsetGroup>
        <ErrorBox error={error} />
      </form>
    </Sheet>
  );
}
