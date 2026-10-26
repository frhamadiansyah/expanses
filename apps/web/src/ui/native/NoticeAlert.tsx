import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../../app/use-escape';
import { cx } from '../index';

/** One row of the alert: full width, centred, a hairline above it. */
export const ALERT_ROW = 'flex min-h-11 w-full items-center justify-center border-t border-[var(--ph-track)] px-3 text-[17px] text-[var(--ph-ink)]';

/**
 * The iPhone-style alert a notice opens: a dimmed backdrop and a centred rounded box with a bold title, a short
 * grey text, then full-width rows split by hairlines — the primary action in bold, and the way out.
 */
export function NoticeAlert({
  title,
  text,
  actions,
  children,
  closeLabel,
  onClose,
  onDismiss,
}: {
  title: string;
  text?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** The last row's words. */
  closeLabel: string;
  onClose: () => void;
  /** When given, the last row dismisses the notice as well as closing the alert. */
  onDismiss?: () => void;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, a')?.focus();
    return () => before?.focus?.();
  }, []);

  // Tab stays inside the alert, as it does in a native one.
  const trap = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), a')];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        onKeyDown={trap}
        className="w-[280px] max-w-full overflow-hidden rounded-[14px] bg-[var(--ph-surface)] text-center shadow-xl backdrop-blur-xl"
      >
        <div className="px-4 pt-5 pb-4">
          <p id={`${id}-t`} className="text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]">
            {title}
          </p>
          <div id={`${id}-d`} className="mt-1 text-[13px] leading-[18px] text-[var(--ph-ink-2)]">
            {text}
          </div>
          {children}
        </div>
        {actions}
        <button
          type="button"
          onClick={() => {
            onClose();
            onDismiss?.();
          }}
          className={cx(ALERT_ROW, 'text-[var(--ph-ink-2)]')}
        >
          {closeLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
