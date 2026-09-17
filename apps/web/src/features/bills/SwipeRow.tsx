import { type ReactNode, useRef, useState } from 'react';
import { cx } from '../../ui';

const REVEAL = 76;
const PAY_AT = 70;
const OPEN_AT = 50;

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
}: {
  children: (suppressClick: () => boolean) => ReactNode;
  enabled: boolean;
  onSwipeRight?: () => void;
  rightHint?: ReactNode;
  leftAction?: ReactNode;
  className?: string;
}) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; base: number; moved: boolean; pointer: number } | null>(null);
  const dragged = useRef(false);
  const canRight = enabled && Boolean(onSwipeRight);
  const canLeft = enabled && Boolean(leftAction);

  return (
    <div className={cx('relative overflow-hidden', className)}>
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
          drag.current = { startX: e.clientX, startY: e.clientY, base: x, moved: false, pointer: e.pointerId };
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
          setX(Math.max(-110, Math.min(110, next)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d?.moved) {
            // A tap on a row left open closes it, and does nothing else.
            if (x !== 0) {
              dragged.current = true;
              setX(0);
            }
            return;
          }
          dragged.current = true;
          if (x > PAY_AT && canRight) {
            setX(0);
            onSwipeRight!();
          } else setX(x < -OPEN_AT && canLeft ? -REVEAL : 0);
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
