import { cx, ErrorBox } from '../../ui';
import { SidePeek } from '../../ui/native/SidePeek';
import { useTwoTap } from '../../ui/two-tap';

const BUTTON = 'rounded-[6px] border px-3 py-[4px] text-[13px] disabled:opacity-40';
const PLAIN = 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';

/** What can be done to several rows at once: the list's own bulk actions, each offered when the list would offer it. */
export interface BulkActions {
  /** Rows the actions reach: picked, still listed, and this workspace's to change (the list's `taggable`). */
  count: number;
  busy: boolean;
  error: unknown;
  onAdd: () => void;
  /** Remove from event, while any of them is in one. */
  onRemove?: () => void;
  /** Move to workspace, while there is another workspace to move to. */
  onMove?: () => void;
  /** Set card, while every one of them is on one credit card account carrying two cards or more. */
  onSetCard?: () => void;
  onDelete: () => void;
}

/** Delete for several: asks twice, in place, saying how many go. */
function DeleteMany({ count, busy, onConfirm }: { count: number; busy: boolean; onConfirm: () => void }) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  const what = count === 1 ? '1 transaction' : `${count} transactions`;
  return (
    <button
      type="button"
      disabled={busy || count === 0}
      onBlur={onBlur}
      onClick={onClick}
      aria-label={armed ? `Click again to delete ${what}` : `Delete ${what}`}
      className={cx(BUTTON, 'w-full text-left', armed ? 'border-[var(--ph-alarm)] bg-[var(--ph-alarm)] text-white' : 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-alarm)] hover:bg-[var(--ph-fill)]')}
    >
      {armed ? `Click again to delete ${what}` : 'Delete'}
    </button>
  );
}

/**
 * The side peek with several rows picked (⌘-click, ⇧-click, ⌘A): how many, what they add up to, and the list's bulk
 * actions — Add to event, Move to workspace, Set card, Delete — so they stay on Cashflow itself. ✕ or Esc lets the rows go.
 */
export function SelectionPeek({
  top = 52,
  picked,
  spent,
  received,
  actions,
  onClose,
}: {
  top?: number;
  /** How many rows are picked. */
  picked: number;
  /** What the picked rows spent and brought in, formatted; null when none did. */
  spent: string | null;
  received: string | null;
  actions: BulkActions;
  onClose: () => void;
}) {
  const left = picked - actions.count;
  const item = cx(BUTTON, PLAIN, 'w-full text-left');
  return (
    <SidePeek top={top} label="Selected transactions" testId="cashflow-selection" title={`${picked} selected`} titleTestId="peek-title" noun="transaction" onClose={onClose}>
      <div className="px-[14px] pb-[10px]">
        <div data-testid="selection-total" className="text-[22px] font-semibold text-[var(--ph-ink)] tabular-nums">
          {spent ?? received ?? '–'}
        </div>
        <div className="mt-[2px] text-[13px] text-[var(--ph-ink-3)]">{spent ? 'Spent' : received ? 'Received' : 'Nothing counted'}</div>
        {spent && received && (
          <div className="mt-[6px] flex justify-between text-[13px]">
            <span className="text-[var(--ph-ink-3)]">Received</span>
            <span className="text-[var(--ph-up)] tabular-nums">+{received}</span>
          </div>
        )}
      </div>
      {left > 0 && (
        <p className="border-t border-[var(--ph-hair)] px-[14px] pt-[10px] text-[12px] text-[var(--ph-ink-3)]">
          {actions.count === 0 ? 'None of them can be changed here.' : `${left} of them can’t be changed here; the actions below reach the other ${actions.count}.`}
        </p>
      )}
      {actions.error ? (
        <div className="px-[14px] pt-[10px]">
          <ErrorBox error={actions.error} />
        </div>
      ) : null}
      <div role="group" aria-label="Actions" className="flex flex-col gap-2 px-[14px] pt-[14px] pb-3">
        <button type="button" className={item} disabled={actions.busy || actions.count === 0} onClick={actions.onAdd}>
          Add to event
        </button>
        {actions.onRemove && (
          <button type="button" className={item} disabled={actions.busy || actions.count === 0} onClick={actions.onRemove}>
            Remove from event
          </button>
        )}
        {actions.onMove && (
          <button type="button" className={item} disabled={actions.busy || actions.count === 0} onClick={actions.onMove}>
            Move to workspace
          </button>
        )}
        {actions.onSetCard && (
          <button type="button" className={item} disabled={actions.busy || actions.count === 0} onClick={actions.onSetCard}>
            Set card
          </button>
        )}
        <DeleteMany key={actions.count} count={actions.count} busy={actions.busy} onConfirm={actions.onDelete} />
      </div>
    </SidePeek>
  );
}
