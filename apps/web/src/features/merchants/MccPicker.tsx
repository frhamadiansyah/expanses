import { mccName } from '@expanses/core';
import { type ReactNode, useState } from 'react';
import { Field, Input } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, SearchField } from '../../ui/native';
import { searchMccs } from './mcc-search';

/** What a four-digit code turns out to be when the list has never heard of it. */
const UNKNOWN = 'Not in the MCC list. Check the code on the bank app or statement.';

/**
 * The native kit's MCC row: one row, "MCC" on the left and the chosen code on the right with what it stands for on a
 * smaller grey line under it, or a grey "Choose"; the chevron says it opens. The finding happens in `MccSearch`, on a
 * step of its own, so the row never grows a field or a list under it.
 */
export function MccRow({ label = 'MCC', value, onOpen }: { label?: string; value: string; onOpen: () => void }) {
  const code = value.length === 4 ? value : '';
  const name = code ? mccName(code) : null;
  return <PickerRow label={label} value={code} placeholder="Choose" onOpen={onOpen} detail={code ? (name ?? UNKNOWN) : undefined} detailTone={name ? 'ink-3' : 'warn'} />;
}

/**
 * The step `MccRow` opens: find a code by name or by its digits. A name lists every code whose name holds each word
 * typed; digits list the codes they start, and four digits the list has never heard of can still be used, since a
 * bank's code is the answer even when the list lags behind it. A row picks; there is nothing else to confirm.
 */
export function MccSearch({ value, onPick }: { value: string; onPick: (mcc: string) => void }) {
  const [query, setQuery] = useState('');
  const text = query.trim();
  const results = searchMccs(text, 30);
  const typedCode = /^\d{4}$/.test(text) ? text : null;
  // Four digits not on the list: offered as they are, under the warning they carry.
  const unlisted = typedCode !== null && !results.some((result) => result.code === typedCode) ? typedCode : null;
  const chosenName = value.length === 4 ? mccName(value) : null;
  return (
    <>
      <div className="mb-[18px] w-full md:max-w-2xl">
        <SearchField
          aria-label="Find an MCC"
          placeholder="Name or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (typedCode) onPick(typedCode);
            else if (results.length === 1) onPick(results[0]!.code);
          }}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>
      {text === '' && value.length === 4 && (
        <InsetGroup header="Chosen">
          <InsetRow title={chosenName ?? UNKNOWN} value={value} onClick={() => onPick(value)} chevron={false} />
        </InsetGroup>
      )}
      {unlisted && (
        <InsetGroup>
          <InsetRow title={`Use ${unlisted}`} subtitle={UNKNOWN} onClick={() => onPick(unlisted)} chevron={false} />
        </InsetGroup>
      )}
      {results.length > 0 && (
        <InsetGroup header="Codes">
          {results.map((result) => (
            <InsetRow key={result.code} title={result.name} value={result.code} onClick={() => onPick(result.code)} chevron={false} />
          ))}
        </InsetGroup>
      )}
      {text !== '' && results.length === 0 && !unlisted && (
        <InsetGroup>
          <InsetRow title={/^\d+$/.test(text) ? 'No code starts with those digits' : 'No MCC matches that name'} chevron={false} />
        </InsetGroup>
      )}
    </>
  );
}

/**
 * Four-digit MCC entry with a name search, in the shape the sheets outside the native kit still use (the purchase's
 * MCC sheet): a code field, the name it stands for, and a field to find one by name. Any four digits are accepted;
 * codes missing from the list get a warning. The native kit's screens use `MccRow` and `MccSearch`, which keep the
 * same rule.
 */
export function MccPicker({ label, value, onChange, hint }: { label: string; value: string; onChange: (mcc: string) => void; hint?: ReactNode }) {
  const [query, setQuery] = useState('');
  const results = searchMccs(query, 8);
  const name = value.length === 4 ? mccName(value) : null;
  const digits = (typed: string) => onChange(typed.replace(/\D/g, '').slice(0, 4));
  // What the code turns out to be, under the field it was typed into: its name, or that the list has never heard of it.
  const found = value.length === 4 ? (name ?? UNKNOWN) : null;

  return (
    <div className="space-y-2">
      <Field label={label} hint={hint}>
        <Input value={value} onChange={(e) => digits(e.target.value)} inputMode="numeric" placeholder="Code" />
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
