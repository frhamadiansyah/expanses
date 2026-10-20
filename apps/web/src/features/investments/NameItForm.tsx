import { CURRENCIES } from '@expanses/core';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import type { FormConfirm } from '../networth/AddAssetForm';
import { type NameDraft, namedSecurity, type Picked } from './add-holding';

/** Name it myself, in the Add Transaction card's Option B look: one card of rows, a line under it, the dock. */
export function NameItForm({ base, onDone, onConfirm }: { base: string; onDone: (picked: Picked) => void; onConfirm: (confirm: FormConfirm | null) => void }) {
  const [draft, setDraft] = useState<NameDraft>({ ticker: '', name: '', market: '', currency: base, lotSize: '' });
  const [error, setError] = useState<unknown>(null);
  const change = (patch: Partial<NameDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const form = useRef<HTMLFormElement>(null);
  // Its ✓ goes on to the purchase, as soon as it has a name.
  const named = draft.name.trim() !== '';
  useEffect(() => {
    onConfirm({ disabled: !named, run: () => form.current?.requestSubmit() });
    return () => onConfirm(null);
  }, [named, onConfirm]);
  const next = (event: FormEvent) => {
    event.preventDefault();
    try {
      onDone({ kind: 'named', security: namedSecurity(draft) });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <form ref={form} onSubmit={next}>
      <InsetGroup footer="Typed once. From then on it behaves like every other holding.">
        <TextRow label="Ticker" value={draft.ticker} onChange={(e) => change({ ticker: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <TextRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Required" required />
        <TextRow label="Market" value={draft.market} onChange={(e) => change({ market: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <SelectRow label="Currency" value={draft.currency} onChange={(e) => change({ currency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Shares in a lot" value={draft.lotSize} onChange={(e) => change({ lotSize: e.target.value })} inputMode="numeric" placeholder="None" />
      </InsetGroup>
      <ErrorBox error={error} />
    </form>
  );
}
