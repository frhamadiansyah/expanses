import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * How far the on-screen keyboard reaches up from the bottom of the window, read from the visual viewport — the
 * part of the page still showing above it. Zero where there is no keyboard, which on a desktop is always.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const measure = () => setInset(Math.max(0, Math.round(window.innerHeight - view.height - view.offsetTop)));
    measure();
    view.addEventListener('resize', measure);
    view.addEventListener('scroll', measure);
    return () => {
      view.removeEventListener('resize', measure);
      view.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}

export type StripCell = { key: string; label: string; title: ReactNode; detail?: string; onPick: () => void };

/**
 * A strip over the keyboard offered the way iOS offers its own words there: up to three cells, each a line and a
 * small grey line under it. A tap takes the cell without the field losing focus. Drawn only on a phone; a desktop
 * has no keyboard for it to ride.
 */
export function KeyboardStrip({
  label,
  cells,
  scroll = false,
}: {
  label: string;
  cells: readonly StripCell[];
  /** Many short cells (a brand's bar sizes) in one row that scrolls sideways, rather than up to three sharing the width. */
  scroll?: boolean;
}) {
  const inset = useKeyboardInset();
  if (cells.length === 0) return null;
  return createPortal(
    <div
      role="listbox"
      aria-label={label}
      className={`fixed inset-x-0 z-50 flex border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)] md:hidden${scroll ? ' overflow-x-auto overscroll-x-contain' : ''}`}
      style={{
        bottom: inset,
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: inset === 0 ? 'env(safe-area-inset-bottom)' : undefined,
      }}
    >
      {cells.map((cell, i) => (
        <Fragment key={cell.key}>
          {i > 0 && <span aria-hidden className="my-[10px] w-[0.5px] shrink-0 bg-[var(--ph-hair)]" />}
          <button
            type="button"
            role="option"
            aria-selected={false}
            aria-label={cell.label}
            // Down, not click: a click would take the focus off the field first and fold the keyboard away under the tap.
            onPointerDown={(e) => e.preventDefault()}
            onClick={cell.onPick}
            className={`ph-focus-inset flex min-h-[48px] flex-col items-center justify-center px-2 py-1 text-center active:bg-[var(--ph-fill)] ${scroll ? 'min-w-[56px] shrink-0' : 'min-w-0 flex-1'}`}
          >
            <span className="w-full truncate text-[15px] leading-5 text-[var(--ph-ink)]">{cell.title}</span>
            {cell.detail && <span className="w-full truncate text-[11px] leading-[14px] text-[var(--ph-ink-3)]">{cell.detail}</span>}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
