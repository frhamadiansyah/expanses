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

/** Less than this between the page's height and the part still showing is the browser's own bars, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

/** Where a bar docked on the keyboard stands: `inset` for its `bottom`, and whether a keyboard is up at all. */
export interface KeyboardDock {
  inset: number;
  shown: boolean;
}

/**
 * The keyboard as a docked bar needs it, from the layout viewport's height (`document.documentElement.clientHeight`,
 * what `position: fixed` is laid out in) and the visual viewport (the part still showing, its top measured from the
 * layout viewport's). Not `window.innerHeight`: iOS 26's web view reports a height there that is neither, so
 * `useKeyboardInset` can read 0 with the keyboard up, or fall short of it. And `shown` is told apart from the inset:
 * with the page scrolled to its foot the keyboard's top is the layout viewport's foot, so the inset is 0 while the
 * keyboard is up.
 */
export function keyboardDock(layoutHeight: number, view: { offsetTop: number; height: number }): KeyboardDock {
  return {
    inset: Math.max(0, Math.round(layoutHeight - view.height - view.offsetTop)),
    shown: layoutHeight - view.height >= KEYBOARD_MIN_PX,
  };
}

/** `keyboardDock`, kept current as the keyboard moves, the page scrolls under it, or the window changes size. */
export function useKeyboardDock(): KeyboardDock {
  const [dock, setDock] = useState<KeyboardDock>({ inset: 0, shown: false });
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const measure = () => {
      const next = keyboardDock(document.documentElement.clientHeight, view);
      setDock((now) => (now.inset === next.inset && now.shown === next.shown ? now : next));
    };
    measure();
    view.addEventListener('resize', measure);
    view.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      view.removeEventListener('resize', measure);
      view.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, []);
  return dock;
}

export type StripCell = { key: string; label: string; title: ReactNode; detail?: string; /** A small grey line above the title, which then reads bold: the figure under its name. */ caption?: string; onPick: () => void };

/**
 * A strip over the keyboard offered the way iOS offers its own words there: up to three cells, each a line and a
 * small grey line under it. A tap takes the cell without the field losing focus. Drawn only on a phone; a desktop
 * has no keyboard for it to ride.
 */
export function KeyboardStrip({
  label,
  cells,
  scroll = false,
  lift = 0,
}: {
  label: string;
  cells: readonly StripCell[];
  /** Many short cells (a brand's bar sizes) in one row that scrolls sideways, rather than up to three sharing the width. */
  scroll?: boolean;
  /** How far above the keyboard it stands: a field docked on the keyboard (Cashflow's One line) keeps it over itself. */
  lift?: number;
}) {
  const inset = useKeyboardInset();
  if (cells.length === 0) return null;
  return createPortal(
    <div
      role="listbox"
      aria-label={label}
      className={`fixed inset-x-0 z-50 flex border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)] md:hidden${scroll ? ' overflow-x-auto overscroll-x-contain' : ''}`}
      style={{
        bottom: inset + lift,
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: inset === 0 && lift === 0 ? 'env(safe-area-inset-bottom)' : undefined,
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
            // iOS moves the focus on the mouse-down it makes up from a touch, not on the pointer-down, so both are held:
            // with the field blurred, the strip left with it and the tap fell on nothing (Stockbit picked, "sto" kept).
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={cell.onPick}
            className={`ph-focus-inset flex min-h-[48px] flex-col items-center justify-center px-2 py-1 text-center active:bg-[var(--ph-fill)] ${scroll ? 'min-w-[56px] shrink-0' : 'min-w-0 flex-1'}`}
          >
            {cell.caption && <span className="w-full truncate text-[11px] leading-[14px] text-[var(--ph-ink-3)]">{cell.caption}</span>}
            <span className={`w-full truncate text-[15px] leading-5 text-[var(--ph-ink)]${cell.caption ? ' tabular font-semibold' : ''}`}>{cell.title}</span>
            {cell.detail && <span className="w-full truncate text-[11px] leading-[14px] text-[var(--ph-ink-3)]">{cell.detail}</span>}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
