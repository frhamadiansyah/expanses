import { type ReactNode, useRef, useState } from 'react';
import { cx } from './index';

const PAY_AT = 70;

/**
 * A row that slides: right past a threshold calls onSwipeRight, left reveals the action behind it. A tap is a tap —
 * the row's own button handles it — and a drag never also counts as a tap.
 */
export function SwipeRow({
  children,
  enabled,
  onSwipeRight,
  rightHint,
  leftAction,
  className,
  reveal = 76,
  testId,
}: {
  children: (suppressClick: () => boolean) => ReactNode;
  enabled: boolean;
  onSwipeRight?: () => void;
  rightHint?: ReactNode;
  leftAction?: ReactNode;
  className?: string;
  /** How far left the row slides to stand open — as wide as the action behind it. */
  reveal?: number;
  testId?: string;
}) {
  // Rounded, so the default really is the 50 bills have used since SwipeRow was written: 76 × 0.66 is 50.16, and
  // "BillRow passes nothing, so bills behave exactly as they do" has to be true rather than nearly true.
  const openAt = Math.round(reveal * 0.66);
  const [x, setXState] = useState(0);
  // The latest offset, for the release: a pointerup can arrive before React has rendered the last move.
  const offset = useRef(0);
  const setX = (next: number) => {
    offset.current = next;
    setXState(next);
  };
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; base: number; moved: boolean; pointer: number } | null>(null);
  const dragged = useRef(false);
  const canRight = enabled && Boolean(onSwipeRight);
  const canLeft = enabled && Boolean(leftAction);

  return (
    // The test id goes here, on the element holding both the action layer and the row content, so a locator
    // scoped to the row reaches the Edit and Delete buttons behind it as well as what is written on its face.
    <div data-testid={testId} className={cx('relative overflow-hidden', className)}>
      <div className="absolute inset-0 flex items-stretch justify-between" aria-hidden={x === 0}>
        <div className="flex items-center bg-emerald-600 px-5 text-sm font-semibold text-white">{x > 0 && rightHint}</div>
        <div className="flex items-stretch">{x < 0 && leftAction}</div>
      </div>
      <div
        className={cx('relative bg-white', !dragging && 'transition-transform duration-150')}
        style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          dragged.current = false;
          if (!enabled) return;
          drag.current = { startX: e.clientX, startY: e.clientY, base: offset.current, moved: false, pointer: e.pointerId };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          if (!d.moved) {
            // Mostly vertical is a scroll, and a few pixels is a shaky tap: neither moves the row.
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.startY)) return;
            d.moved = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(d.pointer);
          }
          let next = d.base + dx;
          if (!canRight) next = Math.min(next, 0);
          if (!canLeft) next = Math.max(next, 0);
          setX(Math.max(-reveal - 34, Math.min(110, next)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d?.moved) {
            // A tap on a row left open closes it, and does nothing else.
            if (offset.current !== 0) {
              dragged.current = true;
              setX(0);
            }
            return;
          }
          dragged.current = true;
          const released = offset.current;
          if (released > PAY_AT && canRight) {
            setX(0);
            onSwipeRight!();
          } else setX(released < -openAt && canLeft ? -reveal : 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setX(0);
        }}
      >
        {children(() => {
          const was = dragged.current;
          dragged.current = false;
          return was;
        })}
      </div>
    </div>
  );
}
