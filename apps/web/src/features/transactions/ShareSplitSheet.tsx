import { formatMinor } from '@expanses/core';
import type { SharedEventView } from '@expanses/db';
import { Check } from 'lucide-react';
import { Sheet } from '../../app/Sheet';
import { SegmentedControl } from '../../ui/native';
import { type SharedExpenseDraft, splitPreview } from './shared-expense-form';

/**
 * Split (shared events §6): tick the people sharing it equally, or type each one's amount. Everyone still in the event
 * is offered. Drawn as the Add screen's With sheet is — the same control across the top, a circle with each person's
 * initials, their share at the right — so a shared event's split is not a second screen to learn (R14). The figures
 * beside each name are `splitPreview`'s, which reads the amount the way the save does.
 */
export function ShareSplitSheet({
  view,
  draft,
  set,
  onClose,
}: {
  view: SharedEventView;
  draft: SharedExpenseDraft;
  set: (patch: Partial<SharedExpenseDraft>) => void;
  onClose: () => void;
}) {
  const people = view.people.filter((p) => !p.removed || draft.ticked.includes(p.personId) || !!draft.amounts[p.personId]);
  const preview = splitPreview(draft);
  const toggle = (personId: string) =>
    set({ ticked: draft.ticked.includes(personId) ? draft.ticked.filter((id) => id !== personId) : [...draft.ticked, personId] });

  return (
    <Sheet grouped title="Split" onClose={onClose}>
      <div className="flex flex-col gap-[10px]">
        <SegmentedControl
          label="How it is split"
          segments={[
            { key: 'equal', label: 'Equal' },
            { key: 'amounts', label: 'By amount' },
          ]}
          value={draft.splitMode}
          onChange={(mode) => set({ splitMode: mode as 'equal' | 'amounts' })}
        />

        <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li_.ph-row-body]:border-t-[0.5px] [&>li+li_.ph-row-body]:border-[var(--ph-hair)]">
          {people.map((p) => {
            const share = preview?.shares[p.personId];
            const ticked = draft.ticked.includes(p.personId);
            const face = (
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[12px] font-semibold text-[var(--ph-ink-2)]">
                {p.initials}
              </span>
            );
            const who = (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-5 text-[var(--ph-ink)]">{p.name}</span>
                {p.isMe && <span className="block text-[12.5px] leading-4 text-[var(--ph-ink-3)]">This phone</span>}
              </span>
            );
            return draft.splitMode === 'equal' ? (
              <li key={p.personId}>
                <button
                  type="button"
                  aria-label={`${p.name} shares it`}
                  aria-pressed={ticked}
                  onClick={() => toggle(p.personId)}
                  data-testid="split-person"
                  className="ph-focus-inset flex w-full items-center gap-[10px] pl-[12px] text-left active:bg-[var(--ph-fill)]"
                >
                  {face}
                  <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 pr-[13px]">
                    {who}
                    <span className="tabular shrink-0 text-right text-[15px] text-[var(--ph-ink-3)]">{ticked && share !== undefined ? formatMinor(share, draft.currency) : ''}</span>
                    <span className="flex w-[18px] shrink-0 justify-center">{ticked && <Check size={18} aria-hidden className="text-[var(--ph-tint)]" />}</span>
                  </span>
                </button>
              </li>
            ) : (
              <li key={p.personId} className="flex items-center gap-[10px] pl-[12px]">
                {face}
                <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 pr-[13px]">
                  {who}
                  <input
                    aria-label={`${p.name}'s share`}
                    className="ph-focus-inset tabular w-28 shrink-0 rounded-lg bg-[var(--ph-fill)] px-2 py-1 text-right text-base text-[var(--ph-ink)] md:text-[15px]"
                    value={draft.amounts[p.personId] ?? ''}
                    inputMode="decimal"
                    placeholder="Amount"
                    onChange={(e) => set({ amounts: { ...draft.amounts, [p.personId]: e.target.value } })}
                  />
                </span>
              </li>
            );
          })}
        </ul>

        {draft.splitMode === 'amounts' && preview && (
          <div data-testid="split-left" className="flex min-h-11 items-center justify-between gap-4 rounded-[11px] bg-[var(--ph-surface)] px-[13px] text-[15px]">
            <span className="text-[var(--ph-ink)]">{preview.leftMinor >= 0 ? 'Left to share' : 'Over by'}</span>
            <span className="tabular text-[var(--ph-ink-3)]">{formatMinor(Math.abs(preview.leftMinor), draft.currency)}</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}
