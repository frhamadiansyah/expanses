import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../../app/use-escape';

/** A text button at the foot of the bubble: open the payment, or take a paid-off mark back. */
export interface BubbleAction {
  label: string;
  onPress: () => void;
  tone?: 'plain' | 'alarm';
  disabled?: boolean;
}

const WIDTH = 250;
const GUTTER = 12;
/** How far the arrow's tip sits from the bubble's left edge, and how far below the ✓'s centre the bubble starts. */
const ARROW_AT = 20;
const BELOW = 17;

/**
 * How a paid purchase was paid, in a small dark bubble under its green ✓ (statement mockup A, 21 Nov 2026): the words in
 * bold, a detail under them when one is known, and at most a text button or two. A tap anywhere else or Escape closes
 * it; Escape gives focus back to the ✓. Drawn over the page, so the rounded list it sits in does not clip it.
 */
export function PaidBubble({
  anchor,
  words,
  detail,
  actions = [],
  onClose,
}: {
  /** The ✓ button it hangs from. */
  anchor: HTMLElement;
  words: string;
  detail?: ReactNode;
  actions?: readonly BubbleAction[];
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [at, setAt] = useState<{ top: number; left: number; arrow: number } | null>(null);

  // Under the ✓'s centre, kept inside the screen; again whenever the page scrolls or the window changes size.
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const width = Math.min(WIDTH, window.innerWidth - GUTTER * 2);
      const left = Math.max(GUTTER, Math.min(x - ARROW_AT, window.innerWidth - GUTTER - width));
      setAt({ top: y + BELOW, left, arrow: x - left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor]);

  // Focus moves in, so a keyboard reaches its buttons and a screen reader reads it.
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
  }, []);

  // A tap anywhere but the bubble closes it. A tap on its own ✓ is left to the ✓, which closes it as a toggle.
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (box.current?.contains(target) || anchor.contains(target))) return;
      latest.current();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor]);

  useEscape(() => {
    onClose();
    anchor.focus({ preventScroll: true });
  });

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="statement-paid-bubble"
      // Tabbing out of it closes it, as a tap outside does.
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !box.current?.contains(next) && !anchor.contains(next)) onClose();
      }}
      style={at ? { top: at.top, left: at.left, width: Math.min(WIDTH, window.innerWidth - GUTTER * 2) } : { visibility: 'hidden' }}
      className="fixed z-[65] rounded-[12px] bg-[var(--ph-bubble)] px-[12px] py-[9px] text-[var(--ph-bubble-ink)] shadow-[var(--ph-bubble-shadow)] outline-none"
    >
      <span aria-hidden className="absolute top-[-6px] h-[12px] w-[12px] rotate-45 bg-[var(--ph-bubble)]" style={{ left: (at?.arrow ?? ARROW_AT) - 6 }} />
      <span id={titleId} data-testid="statement-paid-how" className="relative block text-[13.5px] leading-[18px] font-semibold">
        {words}
      </span>
      {detail ? (
        <span data-testid="statement-paid-detail" className="tabular relative block text-[12px] leading-[16px] text-[var(--ph-bubble-ink-2)]">
          {detail}
        </span>
      ) : null}
      {actions.length > 0 && (
        <span className="relative mt-[2px] -mb-[4px] flex gap-[14px]">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={action.onPress}
              className={`ph-focus -mx-[4px] rounded-[6px] px-[4px] py-[3px] text-[13px] leading-[18px] font-medium disabled:opacity-50 ${action.tone === 'alarm' ? 'text-[var(--ph-bubble-alarm)]' : 'text-[var(--ph-bubble-ink)] underline decoration-[var(--ph-bubble-ink-2)] underline-offset-[2px]'}`}
            >
              {action.label}
            </button>
          ))}
        </span>
      )}
    </div>,
    document.body,
  );
}
