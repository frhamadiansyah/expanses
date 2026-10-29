import { mccName, resolveMcc } from '@expanses/core';
import { type AccountRow, mccSourcesFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, PickerRow, ReadOnlyRow, TextRow } from '../../ui/native';
import { suggestPattern } from '../merchants/mcc-search';
import { MccSearch } from '../merchants/MccPicker';
import type { FormDraft } from './tx-form';

/**
 * The MCC a card purchase is taught, and the merchant it is remembered for — §4's MCC row, as its own screen: a Code row
 * that opens the searchable code list (the merchants screen's own), who it is remembered for, and the merchant text.
 *
 * The line under the code is what would be used if the code were left empty, and where that answer comes from: the
 * merchant taught, the bundled list, or the category. It is worked out by `resolveMcc`, the same function the points
 * engine asks, so the screen cannot promise one code and the engine use another.
 *
 * Leaving the code typed while a merchant text is set is deliberate: `formToPost` clears the purchase's own MCC
 * when a pattern is being remembered, because the memory then supplies it for this purchase and every other one.
 * The Word is the pattern itself: empty remembers nothing, and the grey suggestion in it is the description's first words.
 */
export function McSheet({
  draft,
  onChange,
  accounts,
  onClose,
}: {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  accounts: readonly AccountRow[];
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const [finding, setFinding] = useState(false);
  const set = (patch: Partial<FormDraft>) => onChange({ ...draft, ...patch });
  const sources = useQuery({ queryKey: ['mcc-sources', ws.workspaceId], queryFn: () => mccSourcesFor(database.db, ws) });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // A split bill has no single category; its first row is what the merchant is being guessed from.
  const guessCategory = draft.splits[0]?.categoryId || draft.categoryId;
  const guess = sources.data && guessCategory ? resolveMcc(draft.description, guessCategory, { typed: null, ...sources.data }) : null;
  const guessName = guess?.mcc ? mccName(guess.mcc) : null;
  const guessFrom =
    guess?.source === 'memory'
      ? 'taught here for this merchant'
      : guess?.source === 'bundled'
        ? 'typical for this merchant'
        : `from ${byId.get(guessCategory)?.name ?? 'the category'}`;
  const hint = guess?.mcc ? `Empty uses ${guess.mcc}${guessName ? ` ${guessName}` : ''} (${guessFrom}).` : 'Empty: no MCC is known for this merchant or category yet.';
  const code = draft.mcc.length === 4 ? draft.mcc : '';
  const codeText = code ? `${code} · ${mccName(code) ?? 'Not in the MCC list'}` : null;
  const merchant = draft.description.trim();

  return (
    <Sheet
      grouped
      title={finding ? 'MCC' : 'Merchant type'}
      onClose={onClose}
      back={finding ? { label: 'Merchant type', run: () => setFinding(false) } : undefined}
      confirm={finding ? undefined : { label: 'Done', run: onClose }}
      tall
      expanded={finding}
    >
      {finding ? (
        <MccSearch
          value={draft.mcc}
          onPick={(mcc) => {
            set({ mcc });
            setFinding(false);
          }}
        />
      ) : (
        <>
          <InsetGroup header="Category code (MCC)" footer={code ? undefined : hint}>
            <PickerRow label="Code" value={codeText} placeholder="Choose" onOpen={() => setFinding(true)} />
            <ReadOnlyRow label="Remembered for" value={merchant || null} />
          </InsetGroup>
          <InsetGroup header="Merchant text" footer="Matched as whole words in descriptions on every card, including past purchases.">
            <TextRow
              label="Word"
              value={draft.rememberPattern}
              placeholder={suggestPattern(draft.description) || 'Word'}
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => set({ rememberPattern: e.target.value })}
            />
          </InsetGroup>
        </>
      )}
    </Sheet>
  );
}
