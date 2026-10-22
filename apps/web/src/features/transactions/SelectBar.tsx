import { Ellipsis, X } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox } from '../../ui';

/**
 * The list's select mode, in the title row and nothing else: ✕ on the left to finish, how many are selected in the
 * middle, and a green ⋯ on the right whose menu holds every action — Select All, Add to event, Move to workspace,
 * Remove from event. Nothing is laid over the foot of the screen: the tab bar stays as it was. Each action still opens
 * the sheet that asks which event or workspace.
 */
export function SelectBar({
  count,
  canRemove,
  busy,
  error,
  allSelected,
  onSelectAll,
  onAdd,
  onRemove,
  onCancel,
  onMove,
}: {
  count: number;
  /** Whether any ticked row is in an event at all; nothing else could be taken out of one. */
  canRemove: boolean;
  busy: boolean;
  error: unknown;
  /** Every row that can be ticked is: Select All reads Deselect All. */
  allSelected: boolean;
  onSelectAll: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onCancel: () => void;
  /** Move to workspace, offered while there is more than one workspace to move to. */
  onMove?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const none = count === 0 || busy;
  const pick = (run: () => void) => () => {
    setMenu(false);
    run();
  };
  const circle = 'ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-surface)] shadow-[0_1px_3px_rgb(0_0_0/0.08)]';
  const item = 'ph-focus-inset block w-full border-t-[0.5px] border-[var(--ph-hair)] px-4 py-[11px] text-left text-[var(--ph-ink)] first:border-t-0 disabled:text-[var(--ph-ink-3)]';
  return (
    <div
      role="toolbar"
      aria-label="Selected transactions"
      data-testid="select-bar"
      className="fixed inset-x-0 top-0 z-40 bg-[color-mix(in_srgb,var(--ph-ground)_94%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md"
    >
      <div className="relative mx-auto flex max-w-2xl items-center gap-3 px-4 py-2">
        <button type="button" aria-label="Done" onClick={onCancel} className={`${circle} text-[var(--ph-ink-2)]`}>
          <X size={19} aria-hidden />
        </button>
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-[var(--ph-ink)]">
          {count === 0 ? 'None selected' : `${count} selected`}
        </span>
        <button
          type="button"
          aria-label="Actions"
          aria-expanded={menu}
          disabled={busy}
          onClick={() => setMenu((open) => !open)}
          className={`${circle} text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]`}
        >
          <Ellipsis size={22} aria-hidden />
        </button>
        {menu && (
          <div role="menu" aria-label="Actions" className="absolute top-full right-4 w-64 overflow-hidden rounded-[13px] bg-[var(--ph-surface)] text-[16px] shadow-[0_10px_34px_rgb(0_0_0/0.22)]">
            <button type="button" role="menuitem" onClick={pick(onSelectAll)} className={item}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <div aria-hidden className="h-[7px] bg-[var(--ph-ground)]" />
            <button type="button" role="menuitem" disabled={none} onClick={pick(onAdd)} className={item}>
              Add to event
            </button>
            {onMove && (
              <button type="button" role="menuitem" disabled={none} onClick={pick(onMove)} className={item}>
                Move to workspace
              </button>
            )}
            <button type="button" role="menuitem" disabled={none || !canRemove} onClick={pick(onRemove)} className={item}>
              Remove from event
            </button>
          </div>
        )}
      </div>
      {error ? (
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <ErrorBox error={error} />
        </div>
      ) : null}
    </div>
  );
}
