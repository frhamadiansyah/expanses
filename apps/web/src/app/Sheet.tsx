import { Check, ChevronLeft, Search, X } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import { type Detent, landing } from './sheet-detents';
import { usePhone } from './use-phone';
import { useEscape } from './use-escape';

/** How many sheets are open, so the last one out is the one that gives the page its scrolling back. */
let open = 0;

/**
 * A panel that rises from the bottom of a phone, and sits as a plain dialog on a wider screen.
 *
 * It closes on the backdrop, on Escape and on the button in its corner — three ways out, because a
 * sheet that traps someone on a touch screen has no back button to save them.
 *
 * Escape goes through `useEscape`, which answers the innermost thing open and nothing else: a keypad inside
 * this sheet takes the press, and the sheet keeps the draft it is holding.
 */
export function Sheet({
  title,
  onClose,
  children,
  grouped = false,
  confirm,
  action,
  heading,
  closeHidden = false,
  back,
  tall = false,
  expanded = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Lay the sheet on the kit's grouped ground rather than on a surface, so the white groups inside it read as
   * cards — the look the Add a transaction screens were approved in (Option B). A sheet of plain rows keeps the
   * surface.
   */
  grouped?: boolean;
  /**
   * A sheet that saves: ✕ at the left, the title in the middle and ✓ at the right, dim until it can save —
   * the same ✓ a pushed form carries, so the sheet needs no Save button at its foot.
   */
  confirm?: { label: string; disabled?: boolean; run: () => void };
  /** One more button in a plain sheet's header, just before its ✕ — a list sheet's ⌕. */
  action?: ReactNode;
  /** Drawn in the title's place in a plain sheet's header — a search field, which then moves nothing below it. */
  heading?: ReactNode;
  /**
   * The header's ✕ stands down — while a search is open, whose own ✕ is in its field, so the sheet never shows two
   * ✕ at once. The sheet still closes from the scrim, a swipe or Escape.
   */
  closeHidden?: boolean;
  /**
   * A step inside the sheet rather than a sheet of its own: ‹ in the ✕'s place goes back to where it came from,
   * named for a screen reader. Only with `confirm`.
   */
  back?: { label: string; run: () => void };
  /**
   * iOS detents: the sheet stands at a height of its own — medium (half the screen) or large — whatever it holds, so
   * switching a tab, searching or stepping inside it never moves its top edge. Dragging the grabber or the header
   * moves it between the two, and well below medium closes it. A short list leaves room below; a long one scrolls.
   */
  tall?: boolean;
  /** Go to large and stay there while true: a search that brings the keyboard, a form that needs the room. */
  expanded?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const detents = tall && phone;
  const [detent, setDetent] = useState<Detent>(expanded ? 'large' : 'medium');
  const [dragged, setDragged] = useState<number | null>(null);
    useEffect(() => {
    if (expanded) setDetent('large');
  }, [expanded]);
  const px = (d: Detent) => (d === 'large' ? window.innerHeight * 0.92 : window.innerHeight * 0.5);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!detents) return;
    const height = panel.current?.getBoundingClientRect().height ?? px(detent);
    const d = { y: e.clientY, start: height, last: e.clientY, at: e.timeStamp, prevY: e.clientY, prevAt: e.timeStamp, moving: false };
    // Followed on the window, so a finger that leaves the header mid-drag still drags; a tap on ⌕ or ✕ stays a tap,
    // since nothing happens until the finger has really moved.
    const move = (event: globalThis.PointerEvent) => {
      if (!d.moving && Math.abs(event.clientY - d.y) < 6) return;
      d.moving = true;
      d.prevY = d.last;
      d.prevAt = d.at;
      d.last = event.clientY;
      d.at = event.timeStamp;
      setDragged(Math.min(px('large') + 24, Math.max(80, d.start - (event.clientY - d.y))));
    };
    const up = (event: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!d.moving) return;
      const height = d.start - (event.clientY - d.y);
      // The last two samples give the speed the finger was moving at when it let go.
      const velocity = (d.last - d.prevY) / Math.max(1, d.at - d.prevAt);
      const to = landing({ height, velocity, medium: px('medium'), large: px('large') });
      setDragged(null);
      if (to === 'close') onClose();
      else setDetent(expanded ? 'large' : to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  // Only a tap that both starts and ends on the scrim closes the sheet: a drag let go of outside the sheet does not.
  const scrimDown = useRef(false);

  useEscape(onClose);

  useEffect(() => {
    // The page behind must not scroll while a sheet is over it. Counted, so two sheets open at once
    // cannot leave the page locked when only one of them closes.
    open += 1;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      open -= 1;
      if (open <= 0) {
        open = 0;
        document.body.style.overflow = '';
      }
    };
    // Once, for as long as this sheet is on screen: the count is of sheets, not of renders.
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-[var(--ph-scrim)] md:items-center"
      onPointerDown={(e) => {
        scrimDown.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && scrimDown.current) onClose();
        scrimDown.current = false;
      }}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`${detents ? (dragged === null ? 'transition-[height] duration-300 ease-out' : '') : tall ? 'h-[85dvh] md:h-[80dvh]' : ''} ${detents ? '' : 'max-h-[85dvh]'} w-full overflow-y-auto rounded-t-2xl ${grouped ? 'bg-[var(--ph-ground)]' : 'bg-[var(--ph-surface)]'} p-4 text-[var(--ph-ink)] shadow-xl outline-none md:max-w-2xl md:rounded-2xl`}
        style={{
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          ...(detents ? { height: dragged ?? (detent === 'large' ? '92dvh' : '50dvh') } : {}),
        }}
        data-detent={detents ? detent : undefined}
      >
        {/* The grabber and the header are where the sheet is dragged between its detents, as on iOS. */}
        <div onPointerDown={onDown} className={detents ? 'touch-none' : undefined} data-testid="sheet-drag">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--ph-chevron)] md:hidden" aria-hidden />
        {confirm ? (
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={back ? back.run : onClose}
              aria-label={back ? back.label : 'Close'}
              className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-corner)] text-[var(--ph-ink)]"
            >
              {back ? <ChevronLeft size={22} aria-hidden /> : <X size={18} aria-hidden />}
            </button>
            <h2 className="flex-1 text-center text-base font-semibold">{title}</h2>
            <button
              type="button"
              onClick={confirm.run}
              disabled={confirm.disabled}
              aria-label={confirm.label}
              className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-corner)] text-[var(--ph-ink)] disabled:opacity-40"
            >
              <Check size={20} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="-mt-1 mb-1 flex items-center justify-between gap-3">
            {heading ? <div className="min-w-0 flex-1">{heading}</div> : <h2 className="flex-1 text-base font-semibold">{title}</h2>}
            {/* The header's buttons sit side by side with no gap, as iOS bar buttons do: each is its own 44 px target. */}
            <div className="-mr-2 flex shrink-0 items-center">
              {action}
              {!closeHidden && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]"
                >
                  {/* Drawn larger than ⌕ on purpose: ✕ fills half its box, ⌕ three quarters, so at one size the ✕ looks
                      a third smaller. Same stroke in pixels on both. */}
                  <X size={24} strokeWidth={1.7} absoluteStrokeWidth aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * ⌕ in a list sheet's header, beside its ✕: the way a search is asked for, so no field sits on the list until then
 * (Paid with, Select category). Drawn like the ✕, filled while the search is open.
 */
export function SheetSearchButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search"
      aria-pressed={open}
      className={`flex h-11 w-11 items-center justify-center rounded-xl ${open ? 'bg-[var(--ph-fill)] text-[var(--ph-ink)]' : 'text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]'}`}
    >
      <Search size={17} strokeWidth={1.7} absoluteStrokeWidth aria-hidden />
    </button>
  );
}
