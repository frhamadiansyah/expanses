import { CURRENCIES } from '@expanses/core';
import { type FormEvent, useState } from 'react';
import { ErrorBox, InputRow, RowHint, SelectRow } from '../../ui';
import { FormRows } from '../transactions/FormRow';
import { type NameDraft, namedSecurity, type Picked } from './add-holding';

/** Name it myself, in the Add Transaction card's Option B look: one card of rows, a line under it, the dock. */
export function NameItForm({ base, onDone, onCancel }: { base: string; onDone: (picked: Picked) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<NameDraft>({ ticker: '', name: '', market: '', currency: base, lotSize: '' });
  const [error, setError] = useState<unknown>(null);
  const change = (patch: Partial<NameDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const next = (event: FormEvent) => {
    event.preventDefault();
    try {
      onDone({ kind: 'named', security: namedSecurity(draft) });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <form onSubmit={next} className="flex flex-col gap-[10px]">
      <FormRows>
        <InputRow label="Ticker" value={draft.ticker} onChange={(e) => change({ ticker: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <InputRow label="Name" value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Company or fund" required />
        <InputRow label="Market" value={draft.market} onChange={(e) => change({ market: e.target.value })} placeholder="Optional" autoCapitalize="characters" />
        <SelectRow label="Currency" value={draft.currency} onChange={(e) => change({ currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </SelectRow>
        <InputRow label="Shares in a lot" value={draft.lotSize} onChange={(e) => change({ lotSize: e.target.value })} inputMode="numeric" placeholder="None" />
      </FormRows>
      <RowHint>Typed once. From then on it behaves like every other holding.</RowHint>
      <Dock error={error} onCancel={onCancel} save="Continue" />
    </form>
  );
}

/**
 * The Add Transaction card's dock, as that card draws it: the error above, Cancel beside a pill that submits the form.
 * Exported for `AddHoldingForm`; kept here rather than lifted into the kit, since only these two forms use it yet.
 */
export function Dock({ error, onCancel, save, disabled = false }: { error: unknown; onCancel: () => void; save: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2 pt-1">
      <ErrorBox error={error} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} className="ph-focus min-h-11 shrink-0 rounded-full px-4 text-[15px] text-[var(--ph-ink-2)] active:bg-[var(--ph-fill)]">
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="ph-focus min-h-11 flex-1 rounded-full bg-[var(--ph-tint)] text-[15px] font-semibold text-[var(--ph-surface)] disabled:opacity-50"
        >
          {save}
        </button>
      </div>
    </div>
  );
}
