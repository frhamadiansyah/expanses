import { formatPriceMicro, formatUnits, isoDate, parsePriceMicro, unitsValueMinor } from '@expanses/core';
import { upsertPrice } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input, Money } from '../../ui';

export function PriceForm({
  accountId,
  currency,
  priceLabel,
  priceMicro,
  unitsMicro,
  unitLabel,
}: {
  accountId: string;
  currency: string;
  priceLabel: string;
  priceMicro: number | null;
  unitsMicro: number;
  unitLabel: string;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState(priceMicro === null ? '' : formatPriceMicro(priceMicro, currency).replace(/[^\d.,]/g, ''));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  let preview: number | null = null;
  try {
    preview = typed.trim() === '' ? null : unitsValueMinor(unitsMicro, parsePriceMicro(typed, currency));
  } catch {
    preview = null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await upsertPrice(database, ws, { accountId, onDate: isoDate(), priceMicro: parsePriceMicro(typed, currency) });
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`${priceLabel} today`} className="min-w-48 flex-1">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" placeholder="1.842.000" />
        </Field>
        <Button type="submit" disabled={busy}>
          Update price
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        {formatUnits(unitsMicro)} {unitLabel}
        {preview !== null && (
          <>
            {' '}
            × that price is <Money minor={preview} currency={currency} />
          </>
        )}
      </p>
      <ErrorBox error={error} />
    </form>
  );
}
