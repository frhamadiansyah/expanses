import type { AccountRow } from '@expanses/db';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { PickerRow, SelectCircle } from '../../ui/native';
import { categoryGroups, offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';

/** The row's answer: nothing picked reads "All purchases" (or `none`, for a list that excludes); else the first two names, and +N for the rest. */
export function countsSummary(accounts: readonly AccountRow[], ids: readonly string[], none = 'All purchases'): string {
  if (ids.length === 0) return none;
  const names = ids.map((id) => accounts.find((a) => a.id === id)?.name ?? '?');
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

const GROUP = 'overflow-hidden rounded-[18px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]';

/**
 * Which spending a fee waiver, bonus or earning rule counts: the row says "All purchases" or the picked categories, and
 * a sheet picks them. Many categories, so no single select; the stored value is the list of ids, as the old box held.
 * Ticking a parent names the parent, which already covers its kinds; its kinds are not ticked for it.
 */
export function CountsRow({
  accounts,
  value,
  onChange,
  label = 'Counts',
  never = false,
  info,
}: {
  accounts: readonly AccountRow[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  /** The list of categories that never count: the row reads "None" when empty, and the sheet has no "All purchases" group. */
  never?: boolean;
  info?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickerRow label={label} value={countsSummary(accounts, value, never ? 'None' : 'All purchases')} info={info} onOpen={() => setOpen(true)} testId={never ? 'never-row' : 'counts-row'} />
      {open && (
        <CountsSheet
          title={label}
          never={never}
          accounts={accounts}
          value={value}
          onClose={() => setOpen(false)}
          onConfirm={(ids) => {
            onChange(ids);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function CountsSheet({ title, never, accounts, value, onClose, onConfirm }: { title: string; never: boolean; accounts: readonly AccountRow[]; value: string[]; onClose: () => void; onConfirm: (ids: string[]) => void }) {
  const membership = useCategorySetMembership().data ?? {};
  // Owner-wide: a card's rules belong to the owner and match spending in any book.
  const groups = categoryGroups(offeredCategories(accounts, 'expense', membership, () => true));
  const [draft, setDraft] = useState<string[]>(value);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(groups.filter((g) => g.children.some((c) => value.includes(c.id))).map((g) => g.root.id)));
  const toggle = (id: string) => setDraft((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));
  const fold = (id: string) =>
    setOpened((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const row = (category: AccountRow, child: boolean, kinds: number) => {
    const picked = draft.includes(category.id);
    const shown = opened.has(category.id);
    return (
      <div key={category.id} className={cx('flex items-center', child ? 'pl-[34px]' : 'pl-[14px]')}>
        <button
          type="button"
          role="checkbox"
          aria-checked={picked}
          onClick={() => toggle(category.id)}
          className="ph-focus-inset flex min-h-[50px] min-w-0 flex-1 items-center gap-3 text-left active:bg-[var(--ph-fill)]"
        >
          <SelectCircle picked={picked} />
          <span className={cx('min-w-0 flex-1 truncate text-[var(--ph-ink)]', child ? 'text-[15px]' : 'text-[16px]')}>{category.name}</span>
        </button>
        {kinds > 0 && (
          <button type="button" aria-label={`${category.name} kinds`} aria-expanded={shown} onClick={() => fold(category.id)} className="ph-focus-inset flex h-[50px] w-[44px] shrink-0 items-center justify-center text-[var(--ph-chevron)]">
            {shown ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
          </button>
        )}
      </div>
    );
  };

  return (
    <Sheet grouped tall title={title} onClose={onClose} confirm={{ label: 'Done', run: () => onConfirm(draft) }}>
      <div className="flex flex-col gap-[10px]">
        {!never && (
          <>
            <div className={GROUP}>
              <button type="button" role="checkbox" aria-checked={draft.length === 0} onClick={() => setDraft([])} className="ph-focus-inset flex min-h-[50px] w-full items-center gap-3 pl-[14px] text-left active:bg-[var(--ph-fill)]">
                <SelectCircle picked={draft.length === 0} />
                <span className="flex-1 text-[16px] text-[var(--ph-ink)]">All purchases</span>
              </button>
            </div>
            <p className="px-4 pt-1 text-[13px] uppercase text-[var(--ph-ink-3)]">Or only these</p>
          </>
        )}
        <div className={GROUP}>
          {groups.map(({ root, children }) => (
            <div key={root.id} className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
              {row(root, false, children.length)}
              {opened.has(root.id) && children.map((c) => row(c, true, 0))}
            </div>
          ))}
          {groups.length === 0 && <p className="px-4 py-3 text-[15px] text-[var(--ph-ink-3)]">No categories yet.</p>}
        </div>
      </div>
    </Sheet>
  );
}
