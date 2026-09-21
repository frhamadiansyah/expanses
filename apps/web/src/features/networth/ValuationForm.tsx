import { isoDate, parseMajor, type ValuationBasis } from '@expanses/core';
import { recordValuation } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { BASIS_LABELS } from './labels';

const BASES: ValuationBasis[] = ['estimate', 'appraisal', 'listing', 'njop'];

export function ValuationForm({ accountId, currency }: { accountId: string; currency: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [value, setValue] = useState('');
  const [basis, setBasis] = useState<ValuationBasis>('estimate');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await recordValuation(database, ws, { accountId, asOf: isoDate(), valueMinor: parseMajor(value, currency), basis, note: note.trim() || null });
      setValue('');
      setNote('');
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={submit}>
      <InsetGroup header="What it is worth now" footer="NJOP is kept for the tax report; your net worth uses the other estimates.">
        <TextRow
          label={`What it is worth now (${currency})`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="1.420.000.000"
          required
        />
        <SelectRow label="Where that came from" value={basis} onChange={(e) => setBasis(e.target.value as ValuationBasis)}>
          {BASES.map((option) => (
            <option key={option} value={option}>
              {BASIS_LABELS[option]}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Note" hint="Optional, for example which bank appraised it." value={note} onChange={(e) => setNote(e.target.value)} />
        <InsetRow title="Save estimate" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
      <ErrorBox error={error} />
    </form>
  );
}
