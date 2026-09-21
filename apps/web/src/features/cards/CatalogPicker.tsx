import { CATALOG, type CatalogEntry, describeEntry, planCatalogApply } from '@expanses/catalog';
import { categoryIdsByKeyAll } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { ActionRow, ChoiceRow, GroupColumns, TextLine } from './rows';
import { canApplyEntry, categoryNameForKey, memberLevelsOf, searchCatalog } from './catalog-picker';

/** Searches the bundled catalogue and previews an entry's terms. Without onApply it only previews, showing applyHint instead. */
export function CatalogPicker({
  today,
  selectedId,
  onSelect,
  onApply,
  applyHint,
  debit = false,
  header = 'Find your card',
}: {
  today: string;
  selectedId: string | null;
  onSelect: (entry: CatalogEntry) => void;
  onApply?: (entry: CatalogEntry, memberLevel: string | null, categoryOption: string | null) => void;
  applyHint?: string;
  /** Debit cards for a bank account, credit cards for a credit card: applying the wrong one is refused anyway. */
  debit?: boolean;
  /** What the search group is called where it sits: a setup step asks, a rules list offers. */
  header?: string;
}) {
  const { database, ws } = useApp();
  const [query, setQuery] = useState('');
  const [memberLevel, setMemberLevel] = useState<string | null>(null);
  const [categoryOption, setCategoryOption] = useState<string | null>(null);
  // A card earns wherever it is used, so the preview maps each key to every workspace's copy of that category.
  const categoryKeys = useQuery({ queryKey: ['category-keys', ws.workspaceId], queryFn: () => categoryIdsByKeyAll(database, ws) });
  const forThisCard = CATALOG.filter((entry) => (entry.cardType === 'debit') === debit);
  const matches = searchCatalog(forThisCard, query);
  const selected = CATALOG.find((entry) => entry.id === selectedId);
  const preview = selected ? describeEntry(selected, today) : null;
  const unmapped = selected && categoryKeys.data ? planCatalogApply(selected, categoryKeys.data, today, memberLevel).unmappedKeys : [];
  const levels = selected ? memberLevelsOf(selected) : [];
  const choice = selected?.program.categoryChoice;
  const ready = !!selected && canApplyEntry(selected, memberLevel);

  // Beside the preview on a desktop — a third for the search, two for the terms — as it stood before the kit.
  const note = 'px-[4px] pb-[18px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)] md:pt-[20px]';
  return (
    <GroupColumns wide="second">
      <div className="min-w-0">
        <InsetGroup header={header}>
          <TextRow label="Search catalogue" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BCA, KrisFlyer, Mandiri" />
          {matches.map((entry) => (
            <ChoiceRow
              key={entry.id}
              label={entry.name}
              selected={entry.id === selectedId}
              onClick={() => {
                setMemberLevel(null);
                setCategoryOption(null);
                onSelect(entry);
              }}
            />
          ))}
          {matches.length === 0 && <TextLine tone="ink-3">No card matches. Set it up manually instead.</TextLine>}
        </InsetGroup>
      </div>

      <div className="min-w-0">

        {selected && preview ? (
          <>
            <InsetGroup
              header={preview.heading}
              footer={
                <>
                  Verified {selected.verifiedOn} from{' '}
                  {selected.sources.map((source, i) => (
                    <span key={source.url}>
                      {i > 0 && ', '}
                      <a href={source.url} target="_blank" rel="noreferrer" className="text-[var(--ph-tint)] underline">
                        {source.title}
                      </a>
                    </span>
                  ))}
                  . Estimates only; your statement is the final word.
                </>
              }
            >
              {preview.lines.map((line, i) => (
                <TextLine key={i}>{line}</TextLine>
              ))}
              {unmapped.length > 0 && (
                <TextLine tone="warn">
                  {unmapped.map(categoryNameForKey).join(', ')} {unmapped.length === 1 ? 'was' : 'were'} renamed or removed in this workspace, so purchases
                  there will still earn in estimates.
                </TextLine>
              )}
            </InsetGroup>
            {levels.length > 0 && (
              <InsetGroup footer="This card earns by your standing with the bank, so the rate and the transfer ratio follow it.">
                <SelectRow label={`Your ${selected.program.name} level`} id="member-level" value={memberLevel ?? ''} onChange={(e) => setMemberLevel(e.target.value || null)}>
                  <option value="">Choose your level</option>
                  {levels.map((level) => (
                    <option key={level.key} value={level.key}>
                      {level.name} — {level.condition}
                    </option>
                  ))}
                </SelectRow>
              </InsetGroup>
            )}
            {choice && (
              <InsetGroup footer={`Pick the one you are running now — you can change it ${choice.changeable}. Purchases keep the category that was running on the day they happened.`}>
                <SelectRow label={`Your ${choice.name}`} id="category-choice" value={categoryOption ?? ''} onChange={(e) => setCategoryOption(e.target.value || null)}>
                  <option value="">Choose later</option>
                  {choice.options.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.name}
                    </option>
                  ))}
                </SelectRow>
              </InsetGroup>
            )}
            {onApply ? (
              <InsetGroup>
                <ActionRow label="Use these terms" disabled={!ready} onClick={() => onApply(selected, memberLevel, categoryOption)} />
              </InsetGroup>
            ) : (
              applyHint && <p className={note}>{applyHint}</p>
            )}
          </>
        ) : (
          <p className={note}>Pick a card to preview its earn rates, bonuses, exclusions, and fees.</p>
        )}
      </div>
    </GroupColumns>
  );
}
