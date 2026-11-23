import { ChevronDown, ChevronLeft, ChevronUp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../index';

/** A plain button along the foot of a peek: Edit, Split. */
export const PEEK_BUTTON =
  'rounded-full bg-[var(--mk-pill)] px-[13px] py-[5px] text-[13px] font-semibold text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] disabled:opacity-40';

const STEP = 'flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] hover:text-[var(--ph-ink)] disabled:opacity-30';

/**
 * The side peek's panel (Mac Cashflow D, like Notion's), for any page's rows: it slides in from the right over the page,
 * hanging from the title bar, the page staying where it was underneath. ⌃ ⌄ step to the row before and after, ✕ closes
 * it; the page wires the keys (↑ ↓, Esc) to the same. What it shows is the page's.
 */
export function SidePeek({
  top = 52,
  label,
  testId,
  title,
  titleTestId,
  noun,
  first,
  last,
  onStep,
  onClose,
  back,
  actions,
  children,
}: {
  /** Where the title bar ends on screen: the peek hangs from it. */
  top?: number;
  /** What the panel is, said aloud: "Transaction details". */
  label: string;
  testId: string;
  title: ReactNode;
  titleTestId?: string;
  /** What a step moves to: "transaction" gives "Previous transaction" and "Next transaction". */
  noun: string;
  first?: boolean;
  last?: boolean;
  /** ⌃ ⌄ are drawn only for a peek on one row; several rows at once have no row before or after. */
  onStep?: (by: -1 | 1) => void;
  onClose: () => void;
  /** Opened from another peek (a bill's history, a category's rows): the way back to it, named after it. */
  back?: { label: string; onBack: () => void };
  /** A control of the peek's own, before ✕: a settings peek's Save. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      data-testid={testId}
      style={{ top }}
      className="ph-peek mk-peek fixed right-[10px] bottom-[10px] z-20 flex w-[330px] max-w-full flex-col overflow-y-auto rounded-[22px] bg-[var(--mk-panel)] pt-[8px] shadow-[var(--mk-panel-shadow)]"
    >
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          aria-label={`Back to ${back.label}`}
          className="mx-[8px] mt-[2px] flex max-w-[calc(100%-16px)] items-center gap-[2px] self-start rounded-[5px] px-[4px] py-[2px] text-[12px] text-[var(--mac-accent)] hover:bg-[var(--ph-fill)]"
        >
          <ChevronLeft size={14} aria-hidden className="shrink-0" />
          <span className="truncate">{back.label}</span>
        </button>
      )}
      <h2 className="flex items-start justify-between gap-2 px-[14px] pt-[10px] pb-[8px] text-[17px] leading-[22px] font-bold text-[var(--mk-ink)]">
        <span className="min-w-0 break-words" data-testid={titleTestId}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-[2px]">
          {onStep && (
            <>
              <button type="button" aria-label={`Previous ${noun}`} title="Previous (↑)" disabled={first} onClick={() => onStep(-1)} className={STEP}>
                <ChevronUp size={15} aria-hidden />
              </button>
              <button type="button" aria-label={`Next ${noun}`} title="Next (↓)" disabled={last} onClick={() => onStep(1)} className={STEP}>
                <ChevronDown size={15} aria-hidden />
              </button>
            </>
          )}
          {actions}
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={cx(STEP, 'ml-1')}>
            <X size={15} aria-hidden />
          </button>
        </span>
      </h2>
      {children}
    </aside>
  );
}
