import { isoDate, parseMajor, type ValuationBasis } from '@expanses/core';
import { recordValuation } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Field, Input, Select } from '../../ui';
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

  async function submit(event: FormEvent) {
    event.preventDefault();
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
    <form onSubmit={submit} className="space-y-2">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={`What it is worth now (${currency})`}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="1.420.000.000" required />
        </Field>
        <Field label="Where that came from">
          <Select value={basis} onChange={(e) => setBasis(e.target.value as ValuationBasis)}>
            {BASES.map((option) => (
              <option key={option} value={option}>
                {BASIS_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" hint="Optional, for example which bank appraised it.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">NJOP is kept for the tax report; your net worth uses the other estimates.</p>
      <Button type="submit" disabled={busy}>
        Save estimate
      </Button>
      <ErrorBox error={error} />
    </form>
  );
}
