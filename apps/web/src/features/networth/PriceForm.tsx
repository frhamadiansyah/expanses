import { formatMinor, formatPriceMicro, formatUnits, isoDate, parsePriceMicro, unitsValueMinor } from '@expanses/core';
import { upsertPrice } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';

export function PriceForm({
  accountId,
  currency,
  priceLabel,
  priceMicro,
  unitsMicro,
  unitLabel,
  note,
}: {
  accountId: string;
  currency: string;
  priceLabel: string;
  priceMicro: number | null;
  unitsMicro: number;
  unitLabel: string;
  /** A line under the figure: for a holding linked to a security, whose price this is. */
  note?: string;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState(priceMicro === null ? '' : formatPriceMicro(priceMicro, currency).replace(/[^\d.,]/g, ''));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  let preview: number | null = null;
  try {
    preview = typed.trim() === '' ? null : unitsValueMinor(unitsMicro, parsePriceMicro(typed, currency));
  } catch {
    preview = null;
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
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
    <form ref={form} onSubmit={submit}>
      <InsetGroup
        header="Today's price"
        footer={
          <>
            {formatUnits(unitsMicro)} {unitLabel}
            {preview !== null && <> × that price is {formatMinor(preview, currency)}</>}
            {note && <span className="block">{note}</span>}
          </>
        }
      >
        <TextRow label={`${priceLabel} today`} value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="decimal" placeholder="1.842.000" />
        <InsetRow title="Update price" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
      <ErrorBox error={error} />
    </form>
  );
}
