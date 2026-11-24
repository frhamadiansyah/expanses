import { ChevronDown, ChevronLeft, ChevronUp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../index';
import { macV2 } from '../mac-detail';
import { PANEL_FRAME, PANEL_ROUND, PANEL_SUBTITLE, PANEL_TITLE, PANEL_X } from './panel-frame';

/** A plain button along the foot of a peek: Edit, Split. */
export const PEEK_BUTTON =
  'rounded-full bg-[var(--mk-pill)] px-[13px] py-[5px] text-[13px] font-semibold text-[var(--mk-ink)] hover:bg-[var(--mk-pill-hover)] disabled:opacity-40';

const STEP = 'flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)] hover:text-[var(--ph-ink)] disabled:opacity-30';

/**
 * The side peek's panel (Mac Cashflow D, like Notion's), for any page's rows: it slides in from the right over the page,
 * hanging from the title bar, the page staying where it was underneath. ⌃ ⌄ step to the row before and after, ✕ closes
 * it; the page wires the keys (↑ ↓, Esc) to the same. What it shows is the page's.
 *
 * In the v1 look (owner, 2026-11-24) it is the very panel the add and edit forms open in (`panel-frame`): 410px, the
 * title large with round ⌃ ⌄ ✕ beside it and a grey line under it, so a row's peek and its Edit are one panel. v2 keeps
 * the narrower peek it had.
 */
export function SidePeek({
  top = 52,
  label,
  testId,
  title,
  titleTestId,
  subtitle,
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
  /** The grey line under the title, in the v1 panel: "Sun, 1 Nov 2026 · Recorded". */
  subtitle?: ReactNode;
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
  if (!macV2) {
    return (
      <aside aria-label={label} data-testid={testId} style={{ top }} className={cx('ph-peek mk-peek z-20', PANEL_FRAME)}>
        {/* Everything scrolls but a foot the body pins to the bottom (`PEEK_FOOT`), as the forms' own foot stays put. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-[20px]">
          {back && (
            <button
              type="button"
              onClick={back.onBack}
              aria-label={`Back to ${back.label}`}
              className="mx-[16px] -mt-[8px] mb-[6px] flex max-w-[calc(100%-32px)] items-center gap-[2px] self-start rounded-full px-[6px] py-[3px] text-[13px] font-semibold text-[var(--mk-blue)] hover:bg-[var(--mk-pill)]"
            >
              <ChevronLeft size={15} aria-hidden className="shrink-0" />
              <span className="truncate">{back.label}</span>
            </button>
          )}
          <header className={cx('mb-[14px]', PANEL_X)}>
            <div className="flex items-start gap-[8px]">
              <h2 className={PANEL_TITLE}>
                <span data-testid={titleTestId}>{title}</span>
              </h2>
              {onStep && (
                <>
                  <button type="button" aria-label={`Previous ${noun}`} title="Previous (↑)" disabled={first} onClick={() => onStep(-1)} className={PANEL_ROUND}>
                    <ChevronUp size={16} aria-hidden />
                  </button>
                  <button type="button" aria-label={`Next ${noun}`} title="Next (↓)" disabled={last} onClick={() => onStep(1)} className={PANEL_ROUND}>
                    <ChevronDown size={16} aria-hidden />
                  </button>
                </>
              )}
              {actions}
              <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className={PANEL_ROUND}>
                <X size={15} aria-hidden />
              </button>
            </div>
            {subtitle && (
              <p data-testid="peek-subtitle" className={PANEL_SUBTITLE}>
                {subtitle}
              </p>
            )}
          </header>
          {/* A peek's body keeps its own 14px sides: 8 more here puts them under the title's 22. */}
          <div className="flex flex-1 flex-col px-[8px] pb-[12px]">{children}</div>
        </div>
      </aside>
    );
  }
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

/**
 * The foot of a v1 peek (`SidePeek`): a row of buttons pinned to the panel's bottom while the rows above scroll, as the
 * forms' Cancel and Save are, a hairline over it. Its sides reach the panel's 22px from inside the body's.
 */
export const PEEK_FOOT =
  'sticky bottom-0 z-[1] -mx-[8px] mt-auto -mb-[12px] flex flex-wrap items-center gap-[8px] border-t border-[var(--mk-line)] bg-[var(--mk-panel)] px-[22px] pt-[12px] pb-[16px]';
