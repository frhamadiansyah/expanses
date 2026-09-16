import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

/** How many sheets are open, so the last one out is the one that gives the page its scrolling back. */
let open = 0;

/**
 * A panel that rises from the bottom of a phone, and sits as a plain dialog on a wider screen.
 *
 * It closes on the backdrop, on Escape and on the button in its corner — three ways out, because a
 * sheet that traps someone on a touch screen has no back button to save them.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll while a sheet is over it. Counted, so two sheets open at once
    // cannot leave the page locked when only one of them closes.
    open += 1;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      open -= 1;
      if (open <= 0) {
        open = 0;
        document.body.style.overflow = '';
      }
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 md:items-center" onClick={onClose} role="presentation">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl outline-none md:max-w-2xl md:rounded-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 md:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
