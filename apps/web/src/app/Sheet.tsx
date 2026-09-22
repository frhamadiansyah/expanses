import { X } from 'lucide-react';
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
  compact = false,
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
   * A menu rather than a screen: no grab handle, no title bar, no Close, and a panel that floats clear of the
   * edges and is only as tall as the answers in it. For two or three choices, where a full sheet's chrome is most
   * of the panel. The backdrop and Escape are still the ways out.
   */
  compact?: boolean;
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
        className={`overflow-y-auto ${compact ? 'mb-3 max-h-[70dvh] w-[calc(100%-1.5rem)] rounded-2xl p-1.5 md:mb-0 md:max-w-sm' : 'max-h-[85dvh] w-full rounded-t-2xl p-4 md:max-w-2xl md:rounded-2xl'} ${grouped ? 'bg-[var(--ph-ground)]' : 'bg-[var(--ph-surface)]'} text-[var(--ph-ink)] shadow-xl outline-none`}
        style={{ paddingBottom: compact ? 'calc(0.375rem + env(safe-area-inset-bottom))' : 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        {!compact && (
          <>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--ph-chevron)] md:hidden" aria-hidden />
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ph-ink-3)] hover:bg-[var(--ph-fill)]"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
