import { isoDate, parsePriceMicro } from '@expanses/core';
import { upsertPrice } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input } from '../../ui';
import { Panel } from './Panel';

export interface StaleHolding {
  accountId: string;
  name: string;
  currency: string;
  priceLabel: string;
}

/** One input per holding whose price has gone stale: the monthly routine in a single save. */
export function UpdatePricesSheet({ holdings, onDone }: { holdings: StaleHolding[]; onDone: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const onDate = isoDate();
      const entries = holdings
        .map((holding) => ({ holding, value: (typed[holding.accountId] ?? '').trim() }))
        .filter((entry) => entry.value !== '');
      if (entries.length === 0) throw new Error('Type at least one price, or close this');
      for (const entry of entries) {
        await upsertPrice(database, ws, {
          accountId: entry.holding.accountId,
          onDate,
          priceMicro: parsePriceMicro(entry.value, entry.holding.currency),
        });
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Update prices</h2>
          <p className="text-xs text-slate-500">Type today's price for each holding. Leave one empty to skip it.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {holdings.map((holding) => (
            <Field key={holding.accountId} label={`${holding.name} · ${holding.priceLabel} (${holding.currency})`}>
              <Input
                value={typed[holding.accountId] ?? ''}
                inputMode="decimal"
                onChange={(e) => setTyped({ ...typed, [holding.accountId]: e.target.value })}
              />
            </Field>
          ))}
        </div>
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Save prices
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Close
          </Button>
        </div>
      </form>
    </Panel>
  );
}
