import { mccName } from '@expanses/core';
import { type ReactNode, useState } from 'react';
import { Field, Input } from '../../ui';
import { searchMccs } from './mcc-search';

/** Four-digit MCC entry with a name search. Any four digits are accepted; codes missing from the list get a warning. */
export function MccPicker({ label, value, onChange, hint }: { label: string; value: string; onChange: (mcc: string) => void; hint?: ReactNode }) {
  const [query, setQuery] = useState('');
  const results = searchMccs(query, 8);
  const name = value.length === 4 ? mccName(value) : null;
  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <Input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" placeholder="5812" />
      </Field>
      {value.length === 4 && <p className={name ? 'text-xs text-slate-600' : 'text-xs text-amber-700'}>{name ?? 'Not in the MCC list. Check the code on your bank app or statement.'}</p>}
      <Field label="Find an MCC by name">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="fast food, supermarket" />
      </Field>
      {results.length > 0 && (
        <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 text-sm">
          {results.map((result) => (
            <li key={result.code}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-slate-50"
                onClick={() => {
                  onChange(result.code);
                  setQuery('');
                }}
              >
                <span className="tabular font-medium">{result.code}</span> {result.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
