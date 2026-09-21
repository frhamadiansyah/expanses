import { mccName, resolveMcc } from '@expanses/core';
import { type AccountRow, mccSourcesFor } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { Field, Input } from '../../ui';
import { suggestPattern } from '../merchants/mcc-search';
import { MccPicker } from '../merchants/MccPicker';
import type { FormDraft } from './tx-form';

/**
 * The MCC a card purchase is taught, and the merchant it is remembered for — §4's MCC row, as its own screen.
 *
 * The hint under the picker is what would be used if the field were left empty, and where that answer comes
 * from: the merchant you taught, the bundled list, or the category. It is worked out by `resolveMcc`, the same
 * function the points engine asks, so the screen cannot promise one code and the engine use another.
 *
 * Leaving the code typed while a merchant text is set is deliberate: `formToPost` clears the purchase's own MCC
 * when a pattern is being remembered, because the memory then supplies it for this purchase and every other one.
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
  const set = (patch: Partial<FormDraft>) => onChange({ ...draft, ...patch });
  const sources = useQuery({ queryKey: ['mcc-sources', ws.workspaceId], queryFn: () => mccSourcesFor(database.db, ws) });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  // A split bill has no single category; its first row is what the merchant is being guessed from.
  const guessCategory = draft.splits[0]?.categoryId || draft.categoryId;
  const guess = sources.data && guessCategory ? resolveMcc(draft.description, guessCategory, { typed: null, ...sources.data }) : null;
  const guessName = guess?.mcc ? mccName(guess.mcc) : null;
  const guessFrom =
    guess?.source === 'memory'
      ? 'you taught this merchant'
      : guess?.source === 'bundled'
        ? 'typical for this merchant'
        : `from ${byId.get(guessCategory)?.name ?? 'the category'}`;
  const hint = guess?.mcc ? `Empty uses ${guess.mcc}${guessName ? ` ${guessName}` : ''} (${guessFrom}).` : 'Empty: no MCC is known for this merchant or category yet.';

  return (
    <Sheet grouped title="MCC" onClose={onClose}>
      {/* The same fields as before — the MCC picker is the merchants screen's own — gathered on one card. */}
      <div className="space-y-3 rounded-[11px] bg-[var(--ph-surface)] p-[13px]">
        <MccPicker label="MCC" value={draft.mcc} onChange={(mcc) => set({ mcc })} hint={hint} />
        <label className="flex min-h-11 items-center gap-2 text-[15px] text-[var(--ph-ink)]">
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-[var(--ph-tint)]"
            checked={!!draft.rememberPattern}
            onChange={(e) => set({ rememberPattern: e.target.checked ? suggestPattern(draft.description) || draft.description.trim().toLowerCase() : '' })}
          />
          Remember this MCC for every purchase containing the merchant text
        </label>
        {draft.rememberPattern && (
          <Field label="Merchant text" hint="Matched as whole words in descriptions, on every card, including past purchases.">
            <Input value={draft.rememberPattern} onChange={(e) => set({ rememberPattern: e.target.value })} />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
