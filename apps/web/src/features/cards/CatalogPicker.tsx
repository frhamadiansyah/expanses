import { CATALOG, type CatalogEntry, describeEntry, planCatalogApply } from '@expanses/catalog';
import { categoryIdsByKey } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Button, cx, Field, Input, Select } from '../../ui';
import { canApplyEntry, categoryNameForKey, memberLevelsOf, searchCatalog } from './catalog-picker';

/** Searches the bundled catalogue and previews an entry's terms. Without onApply it only previews, showing applyHint instead. */
export function CatalogPicker({
  today,
  selectedId,
  onSelect,
  onApply,
  applyHint,
}: {
  today: string;
  selectedId: string | null;
  onSelect: (entry: CatalogEntry) => void;
  onApply?: (entry: CatalogEntry, memberLevel: string | null) => void;
  applyHint?: string;
}) {
  const { database, ws } = useApp();
  const [query, setQuery] = useState('');
  const [memberLevel, setMemberLevel] = useState<string | null>(null);
  const categoryKeys = useQuery({ queryKey: ['category-keys', ws.workspaceId], queryFn: () => categoryIdsByKey(database, ws) });
  const matches = searchCatalog(CATALOG, query);
  const selected = CATALOG.find((entry) => entry.id === selectedId);
  const preview = selected ? describeEntry(selected, today) : null;
  const unmapped = selected && categoryKeys.data ? planCatalogApply(selected, categoryKeys.data, today, memberLevel).unmappedKeys : [];
  const levels = selected ? memberLevelsOf(selected) : [];
  const ready = !!selected && canApplyEntry(selected, memberLevel);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-2">
        <Field label="Search catalogue">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BCA, KrisFlyer, Mandiri" />
        </Field>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200">
          {matches.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                aria-pressed={entry.id === selectedId}
                onClick={() => {
                  setMemberLevel(null);
                  onSelect(entry);
                }}
                className={cx('w-full px-3 py-2 text-left text-sm hover:bg-slate-50', entry.id === selectedId && 'bg-emerald-50 font-medium')}
              >
                {entry.name}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No card matches. Set it up manually instead.</li>}
        </ul>
      </div>

      {selected && preview ? (
        <div className="space-y-2 text-sm">
          <h3 className="font-semibold">{preview.heading}</h3>
          <ul className="list-disc space-y-1 pl-5 text-slate-700">
            {preview.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {unmapped.length > 0 && (
            <p className="text-amber-700">
              {unmapped.map(categoryNameForKey).join(', ')} {unmapped.length === 1 ? 'was' : 'were'} renamed or removed in this workspace, so purchases
              there will still earn in estimates.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Verified {selected.verifiedOn} from{' '}
            {selected.sources.map((source, i) => (
              <span key={source.url}>
                {i > 0 && ', '}
                <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                  {source.title}
                </a>
              </span>
            ))}
            . Estimates only; your statement is the final word.
          </p>
          {levels.length > 0 && (
            <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
              <Field label={`Your ${selected.program.name} level`} hint="This card earns by your standing with the bank, so the rate and the transfer ratio follow it.">
                <Select id="member-level" value={memberLevel ?? ''} onChange={(e) => setMemberLevel(e.target.value || null)}>
                  <option value="">Choose your level</option>
                  {levels.map((level) => (
                    <option key={level.key} value={level.key}>
                      {level.name} — {level.condition}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {onApply ? (
            <Button disabled={!ready} onClick={() => onApply(selected, memberLevel)}>
              Use these terms
            </Button>
          ) : (
            applyHint && <p className="text-xs text-slate-500">{applyHint}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Pick a card to preview its earn rates, bonuses, exclusions, and fees.</p>
      )}
    </div>
  );
}
