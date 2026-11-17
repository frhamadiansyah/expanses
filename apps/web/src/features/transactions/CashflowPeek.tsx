import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { useTwoTap } from '../../ui/two-tap';

/** One transaction as the side peek shows it, worked out by the page from the row. */
export interface PeekView {
  id: string;
  /** The note, or the category when there is none. */
  title: string;
  /** "Rp 112.300", with + on money in. */
  amount: string;
  income: boolean;
  /** "Wed 11 Nov 2026". */
  date: string;
  /** Label and value, in the order drawn: Category, Paid with, Counts as, Workspace, Event, Receipt, Points. */
  rows: { label: string; value: ReactNode; tone?: 'muted' | 'up' }[];
  /** A line above the buttons: why it cannot be changed here, and where it can. */
  notice?: ReactNode;
  canEdit: boolean;
  canSplit: boolean;
  canDelete: boolean;
}

const BUTTON = 'rounded-[6px] border px-3 py-[4px] text-[13px] disabled:opacity-40';
const PLAIN = 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';
const STEP = 'flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] hover:text-[var(--ph-ink)] disabled:opacity-30';

/** Delete asks twice, in place, as the receipt's and the old table's do: the state dies with the button. */
function DeletePeek({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  const { armed, onBlur, onClick } = useTwoTap(onConfirm);
  return (
    <button
      type="button"
      disabled={busy}
      onBlur={onBlur}
      onClick={onClick}
      aria-label={armed ? 'Click again to delete' : 'Delete this transaction'}
      className={cx(BUTTON, armed ? 'border-[var(--ph-alarm)] bg-[var(--ph-alarm)] text-white' : 'border-[var(--ph-chevron)] bg-[var(--ph-surface)] text-[var(--ph-alarm)] hover:bg-[var(--ph-fill)]')}
    >
      {armed ? 'Click again to delete' : 'Delete'}
    </button>
  );
}

/**
 * The side peek (Mac Cashflow D, like Notion's): a clicked row's details slide in from the right over the page, the
 * table staying where it was underneath. ⌃ ⌄ (and ↑ ↓) step to the row before and after, ✕ (and Esc) close it, and
 * Edit — or a double-click or Return on the row — opens the full edit screen.
 */
export function CashflowPeek({
  top = 52,
  view,
  first,
  last,
  busy,
  onStep,
  onClose,
  onEdit,
  onSplit,
  onDelete,
}: {
  /** Where the title bar ends on screen: the peek hangs from it. */
  top?: number;
  view: PeekView;
  first: boolean;
  last: boolean;
  busy: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onEdit: () => void;
  onSplit: () => void;
  onDelete: () => void;
}) {
  return (
    <aside
      aria-label="Transaction details"
      data-testid="cashflow-peek"
      style={{ top }}
      className="ph-peek fixed right-0 bottom-0 z-20 flex w-[330px] max-w-full flex-col overflow-y-auto border-l border-[var(--ph-chevron)] bg-[var(--ph-surface)] pt-[6px] shadow-[-12px_0_30px_rgba(0,0,0,0.12)]"
    >
      <h2 className="flex items-start justify-between gap-2 px-[14px] pt-[10px] pb-[6px] text-[13px] font-semibold text-[var(--ph-ink)]">
        <span className="min-w-0 break-words" data-testid="peek-title">
          {view.title}
        </span>
        <span className="flex shrink-0 items-center gap-[2px]">
          <button type="button" aria-label="Previous transaction" title="Previous (↑)" disabled={first} onClick={() => onStep(-1)} className={STEP}>
            <ChevronUp size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Next transaction" title="Next (↓)" disabled={last} onClick={() => onStep(1)} className={STEP}>
            <ChevronDown size={15} aria-hidden />
          </button>
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={cx(STEP, 'ml-1')}>
            <X size={15} aria-hidden />
          </button>
        </span>
      </h2>
      <div className="px-[14px] pb-[10px]">
        <div data-testid="peek-amount" className={cx('text-[22px] font-semibold tabular-nums', view.income ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>
          {view.amount}
        </div>
        <div className="mt-[2px] text-[13px] text-[var(--ph-ink-3)]">{view.date}</div>
      </div>
      <dl className="border-t border-[var(--ph-hair)]">
        {view.rows.map((row) => (
          <div key={row.label} className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px] first:border-t-0">
            <dt className="w-[84px] shrink-0 text-[var(--ph-ink-3)]">{row.label}</dt>
            <dd className={cx('min-w-0 flex-1 break-words', row.tone === 'muted' ? 'text-[var(--ph-ink-3)]' : row.tone === 'up' ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]')}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {view.notice && <div className="border-t border-[var(--ph-hair)] px-[14px] pt-[10px] text-[12px] text-[var(--ph-ink-3)]">{view.notice}</div>}
      <div className="flex flex-wrap gap-2 px-[14px] pt-[14px] pb-3">
        <button type="button" className={cx(BUTTON, PLAIN)} disabled={!view.canEdit} onClick={onEdit}>
          Edit
        </button>
        <button type="button" className={cx(BUTTON, PLAIN)} disabled={!view.canSplit} onClick={onSplit}>
          Split
        </button>
        {view.canDelete && <DeletePeek key={view.id} busy={busy} onConfirm={onDelete} />}
      </div>
    </aside>
  );
}
