import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox } from '../../ui';

/**
 * The list's select mode, as Notes and Mail draw it: across the top, Select All, how many are selected and Done; at
 * the foot, a thin toolbar of words — Add to event, Move — and ⋯, whose menu holds every action, Remove from event
 * among them. Each action still opens the sheet that asks which event or workspace.
 *
 * The foot sits where the Undo toast sits, above the phone's tab bar, so the toast that follows an action lands where
 * the bar just was. Its own error line, because a refusal said at the top of the page, while a thumb is down here, is
 * a refusal nobody sees.
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
  const word = 'ph-focus min-h-11 shrink-0 text-[17px] text-[var(--ph-tint)] disabled:text-[var(--ph-ink-3)]';
  const glass = 'border-[var(--ph-hair)] bg-[color-mix(in_srgb,var(--ph-ground)_94%,transparent)] backdrop-blur-md';
  return (
    <>
      <div role="toolbar" aria-label="Selection" data-testid="select-top" className={`fixed inset-x-0 top-0 z-40 border-b-[0.5px] pt-[env(safe-area-inset-top)] ${glass}`}>
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4">
          <button type="button" onClick={onSelectAll} className={word}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <span aria-live="polite" className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-[var(--ph-ink)]">
            {count === 0 ? 'None selected' : `${count} Selected`}
          </span>
          <button type="button" onClick={onCancel} className={`${word} font-semibold`}>
            Done
          </button>
        </div>
      </div>
      <div
        role="toolbar"
        aria-label="Selected transactions"
        data-testid="select-bar"
        className={`fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 border-t-[0.5px] md:bottom-0 ${glass}`}
      >
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-3 px-5">
          <button type="button" disabled={none} onClick={onAdd} className={word}>
            Add to event
          </button>
          {onMove && (
            <button type="button" disabled={none} onClick={onMove} className={word}>
              Move
            </button>
          )}
          <button type="button" aria-label="More actions" aria-expanded={menu} disabled={none} onClick={() => setMenu((open) => !open)} className={`${word} flex items-center`}>
            <Ellipsis size={22} aria-hidden />
          </button>
          {menu && (
            <div role="menu" aria-label="Actions" className="absolute right-3 bottom-full mb-2 w-60 overflow-hidden rounded-[13px] bg-[var(--ph-surface)] text-[16px] shadow-[0_10px_34px_rgb(0_0_0/0.22)]">
              <button type="button" role="menuitem" onClick={pick(onAdd)} className="ph-focus-inset block w-full px-4 py-[11px] text-left text-[var(--ph-ink)]">
                Add to event
              </button>
              {onMove && (
                <button type="button" role="menuitem" onClick={pick(onMove)} className="ph-focus-inset block w-full border-t-[0.5px] border-[var(--ph-hair)] px-4 py-[11px] text-left text-[var(--ph-ink)]">
                  Move to workspace
                </button>
              )}
              <div aria-hidden className="h-[7px] bg-[var(--ph-ground)]" />
              <button
                type="button"
                role="menuitem"
                disabled={!canRemove}
                onClick={pick(onRemove)}
                className="ph-focus-inset block w-full px-4 py-[11px] text-left text-[var(--ph-ink)] disabled:text-[var(--ph-ink-3)]"
              >
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
    </>
  );
}
