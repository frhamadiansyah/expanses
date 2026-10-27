import { createPortal } from 'react-dom';
import { useEscape } from '../../app/use-escape';

const OPTION = 'flex min-h-[52px] w-full items-center justify-center border-t border-[var(--ph-track)] px-3 text-[17px] text-[var(--ph-ink)] first:border-t-0';

/**
 * The iOS-style action sheet Add workspace opens: grouped choices at the bottom, a separate Cancel under them, a
 * dimmed backdrop that closes it as well.
 */
export function AddWorkspaceSheet({ onNew, onJoin, onClose }: { onNew: () => void; onJoin: () => void; onClose: () => void }) {
  useEscape(onClose);
  return createPortal(
    <div
      data-testid="add-workspace-sheet"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-[10px] pb-[calc(10px+env(safe-area-inset-bottom))]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Add workspace" className="w-full max-w-[420px]">
        <div className="mb-2 overflow-hidden rounded-[14px] bg-[var(--ph-surface)] shadow-xl">
          <button type="button" data-testid="new-workspace" onClick={onNew} className={OPTION}>
            New workspace
          </button>
          <button type="button" data-testid="join-workspace-choice" onClick={onJoin} className={OPTION}>
            Join with a code
          </button>
        </div>
        <button type="button" onClick={onClose} className="flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[var(--ph-surface)] px-3 text-[17px] font-semibold text-[var(--ph-ink)] shadow-xl">
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}
