import { useRouterState } from '@tanstack/react-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ReceiptPeek } from './ReceiptPeek';
import { windowTopInset } from '../../ui/native/window-top';

/**
 * Opens a transaction's Mac receipt (`ReceiptPeek`) over the page: `back` names the page's own peek it was opened from
 * (a bill, a category, an account), which the receipt then covers, with ‹ back to it. Null on a phone, where a
 * transaction opens its receipt page as it always has.
 */
export type OpenReceipt = (transactionId: string, opts?: { back?: string }) => void;

const ReceiptPeekContext = createContext<OpenReceipt | null>(null);

/** The wide screen's way to open a transaction; null on a phone (and outside the shell). */
export function useOpenReceipt(): OpenReceipt | null {
  return useContext(ReceiptPeekContext);
}

interface Open {
  id: string;
  back: string | null;
  top: number;
}

/**
 * The one receipt peek the wide-screen shell keeps for pages that open a transaction from somewhere other than
 * Cashflow's table (whose own rows open it in place): a page's peek rows — a bill's history, a category's
 * transactions, a card's last rows, a recorded capture — and an account's history list.
 *
 * Opened from a page's peek it takes that peek's place, the same panel at the same height, with ‹ back to it (Esc or
 * the back row); the page keeps the room it made for its own peek. Opened from a page with no peek (an account's
 * history) the shell makes room for it (`room`). A click on the page behind it, or a move to another page, puts it away.
 */
export function useReceiptPeekHost(enabled: boolean): { room: boolean; provide: (children: ReactNode) => ReactNode } {
  const [open, setOpen] = useState<Open | null>(null);
  const href = useRouterState({ select: (s) => s.location.href });
  const close = useCallback(() => setOpen(null), []);
  const panel = useRef<HTMLDivElement>(null);

  // Another page: the receipt belonged to the one left.
  useEffect(() => setOpen(null), [href]);

  useEffect(() => {
    if (!open) return;
    const covered = () => document.querySelector('[role="dialog"]') !== null;
    // Esc puts it away (back to the page's peek, when it covers one); the page's own keys wait while it is open, so ↑ ↓
    // do not step the rows behind it.
    const keys = (event: KeyboardEvent) => {
      if (covered()) return;
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(null);
        return;
      }
      const control = !!target?.closest('input, textarea, select, button, a, [contenteditable="true"]');
      if (!control && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Enter')) event.stopPropagation();
    };
    // A click on the page behind it: the receipt goes, and the click does what it does there.
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || panel.current?.contains(target) || target.closest('[role="dialog"], [role="presentation"]')) return;
      setOpen(null);
    };
    window.addEventListener('keydown', keys, true);
    document.addEventListener('mousedown', away, true);
    return () => {
      window.removeEventListener('keydown', keys, true);
      document.removeEventListener('mousedown', away, true);
    };
  }, [open]);

  const openReceipt = useCallback<OpenReceipt>((id, opts) => {
    // Over a page's peek it hangs where that one does; on its own, from the top of the window (below the Mac's title strip).
    const under = opts?.back ? document.querySelector('aside.ph-peek') : null;
    setOpen({ id, back: opts?.back ?? null, top: under ? Math.max(0, under.getBoundingClientRect().top) : windowTopInset() });
  }, []);

  const provide = (children: ReactNode) => (
    <ReceiptPeekContext.Provider value={enabled ? openReceipt : null}>
      {children}
      {enabled && open && (
        <div ref={panel} data-receipt-peek>
          <ReceiptPeek
            transactionId={open.id}
            top={open.top}
            testId="receipt-peek"
            onClose={close}
            back={open.back ? { label: open.back, onBack: close } : undefined}
            onReplaced={(id) => setOpen((was) => (was ? { ...was, id } : was))}
          />
        </div>
      )}
    </ReceiptPeekContext.Provider>
  );
  return { room: enabled && open !== null && open.back === null, provide };
}
