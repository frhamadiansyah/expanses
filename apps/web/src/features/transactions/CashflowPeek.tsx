import { cx, ErrorBox } from '../../ui';
import { macV2 } from '../../ui/mac-detail';
import { SidePeek } from '../../ui/native/SidePeek';
import { useTwoTap } from '../../ui/two-tap';

// The v1 panel's pills (owner, 2026-11-24), as the transaction peek's foot draws them; v2 keeps its bordered buttons.
const BUTTON = macV2 ? 'rounded-[6px] border px-3 py-[4px] text-[13px] disabled:opacity-40' : 'h-[34px] rounded-full px-[15px] text-[13.5px] font-semibold disabled:opacity-40';
const PLAIN = macV2 ? 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]' : 'bg-[var(--mk-pill)] text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)]';
/** Delete, asking or not: red words on the plain button; red filled while it asks. */
const ALARM = macV2
  ? { armed: 'border-[var(--ph-alarm)] bg-[var(--ph-alarm)] text-white', rest: 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-alarm)] hover:bg-[var(--ph-fill)]' }
  : { armed: 'bg-[var(--mk-c-red)] text-white', rest: 'bg-[var(--mk-pill)] text-[var(--mk-c-red)] hover:bg-[var(--mk-pill-hover)]' };
/** Record N: the dark button. */
const DARK = macV2 ? 'border-[var(--ph-ink)] bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--mk-black)] text-[var(--mk-black-ink)] hover:opacity-90';

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

/** Record N, with waiting rows (typed or pasted, not recorded yet) among the rows picked (Mac Cashflow option E). */
export interface RecordMany {
  /** Waiting rows picked. */
  count: number;
  /** Of those, the complete ones: what Record N records. */
  ready: number;
  /** "1 missing a date, amount or Paid with is skipped", when some are. */
  skipped: string | null;
  /** Under the total, with only waiting rows picked: "10 waiting rows · 1 Aug – 12 Sep 2026" (`waitingSpan`). */
  span?: string;
  /** What the waiting rows picked add up to (formatted), said while no recorded row is picked. */
  total: string | null;
  busy: boolean;
  onRecord: () => void;
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
      className={cx(BUTTON, 'w-full text-left', armed ? ALARM.armed : ALARM.rest)}
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
  record,
  onClose,
}: {
  top?: number;
  /** How many rows are picked. */
  picked: number;
  /** What the picked rows spent and brought in, formatted; null when none did. */
  spent: string | null;
  received: string | null;
  actions: BulkActions;
  /** Waiting rows among them: Record N, before the recorded rows' actions. */
  record?: RecordMany | undefined;
  onClose: () => void;
}) {
  const waiting = record?.count ?? 0;
  // Rows the actions do not reach, waiting rows aside: those have Record N.
  const left = picked - waiting - actions.count;
  const onlyWaiting = waiting > 0 && waiting === picked;
  const item = cx(BUTTON, PLAIN, 'w-full text-left');
  return (
    <SidePeek top={top} label="Selected transactions" testId="cashflow-selection" title={`${picked} selected`} titleTestId="peek-title" noun="transaction" onClose={onClose}>
      <div className="px-[14px] pb-[10px]">
        <div data-testid="selection-total" className={cx('text-[var(--ph-ink)] tabular-nums', macV2 ? 'text-[22px] font-semibold' : 'text-[30px] leading-[36px] font-extrabold tracking-[-0.4px]')}>
          {spent ?? received ?? (onlyWaiting ? record?.total : null) ?? '–'}
        </div>
        <div data-testid="selection-note" className="mt-[2px] text-[13px] text-[var(--ph-ink-3)]">
          {spent ? 'Spent' : received ? 'Received' : onlyWaiting && record?.total ? (record.span ?? 'Not recorded yet') : 'Nothing counted'}
        </div>
        {spent && received && (
          <div className="mt-[6px] flex justify-between text-[13px]">
            <span className="text-[var(--ph-ink-3)]">Received</span>
            <span className="text-[var(--ph-up)] tabular-nums">+{received}</span>
          </div>
        )}
      </div>
      {record && (
        <div className="flex flex-col gap-[6px] border-t border-[var(--ph-hair)] px-[14px] pt-[12px]">
          <button
            type="button"
            data-testid="record-many"
            disabled={record.busy || record.ready === 0}
            onClick={record.onRecord}
            className={cx(BUTTON, 'w-full text-left font-medium', DARK)}
          >
            Record {record.ready}
          </button>
          {record.skipped && (
            <p data-testid="record-skipped" className="text-[12px] text-[var(--ph-ink-3)]">
              {record.skipped}
            </p>
          )}
        </div>
      )}
      {left > 0 && !onlyWaiting && (
        <p className="border-t border-[var(--ph-hair)] px-[14px] pt-[10px] text-[12px] text-[var(--ph-ink-3)]">
          {actions.count === 0 ? 'None of them can be changed here.' : `${left} of them can’t be changed here; the actions below reach the other ${actions.count}.`}
        </p>
      )}
      {actions.error ? (
        <div className="px-[14px] pt-[10px]">
          <ErrorBox error={actions.error} />
        </div>
      ) : null}
      {!onlyWaiting && (
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
      )}
    </SidePeek>
  );
}
