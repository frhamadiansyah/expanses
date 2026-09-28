import { Check, Search, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
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
}) {
  const panel = useRef<HTMLDivElement>(null);

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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[var(--ph-scrim)] md:items-center" onClick={onClose} role="presentation">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl ${grouped ? 'bg-[var(--ph-ground)]' : 'bg-[var(--ph-surface)]'} p-4 text-[var(--ph-ink)] shadow-xl outline-none md:max-w-2xl md:rounded-2xl`}
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--ph-chevron)] md:hidden" aria-hidden />
        {confirm ? (
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ph-corner)] text-[var(--ph-ink)]"
            >
              <X size={18} aria-hidden />
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
          <div className="mb-3 flex items-center justify-between gap-3">
            {heading ? <div className="min-w-0 flex-1">{heading}</div> : <h2 className="flex-1 text-base font-semibold">{title}</h2>}
            {action}
            {!closeHidden && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]"
              >
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
        )}
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
      <Search size={18} aria-hidden />
    </button>
  );
}
