import { mccName } from '@expanses/core';
import { type ReactNode, useState } from 'react';
import { Field, Input } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { searchMccs } from './mcc-search';

/**
 * Four-digit MCC entry with a name search. Any four digits are accepted; codes missing from the list get a warning.
 *
 * One component, two dresses. `native` draws the same two fields and the same result list as a grouped inset list,
 * for the screens that have adopted the native kit; without it the control keeps the shape the sheets around it
 * still use. The search, the warning and the four-digit rule are written once either way — a second picker for the
 * kit would be a second place for "any four digits are accepted" to drift.
 */
export function MccPicker({
  label,
  value,
  onChange,
  hint,
  native = false,
  header,
}: {
  label: string;
  value: string;
  onChange: (mcc: string) => void;
  hint?: ReactNode;
  native?: boolean;
  /** The group's header, when drawn in the kit. */
  header?: string;
}) {
  const [query, setQuery] = useState('');
  const results = searchMccs(query, 8);
  const name = value.length === 4 ? mccName(value) : null;
  const digits = (typed: string) => onChange(typed.replace(/\D/g, '').slice(0, 4));
  // What the code turns out to be, under the field it was typed into: its name, or that the list has never heard of it.
  const found = value.length === 4 ? (name ?? 'Not in the MCC list. Check the code on your bank app or statement.') : null;

  if (native) {
    return (
      <InsetGroup header={header} footer={hint}>
        <TextRow
          label={label}
          value={value}
          onChange={(e) => digits(e.target.value)}
          inputMode="numeric"
          placeholder="5812"
          hint={found && <span className={name ? undefined : 'text-[var(--ph-warn)]'}>{found}</span>}
        />
        <TextRow label="Find an MCC by name" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="fast food, supermarket" />
        {results.map((result) => (
          <InsetRow
            key={result.code}
            title={result.name}
            value={result.code}
            onClick={() => {
              onChange(result.code);
              setQuery('');
            }}
            chevron={false}
          />
        ))}
      </InsetGroup>
    );
  }

  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <Input value={value} onChange={(e) => digits(e.target.value)} inputMode="numeric" placeholder="5812" />
      </Field>
      {value.length === 4 && <p className={name ? 'text-xs text-slate-600' : 'text-xs text-amber-700'}>{found}</p>}
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
