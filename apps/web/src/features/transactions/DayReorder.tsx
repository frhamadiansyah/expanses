import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef } from 'react';
import { cx } from '../../ui';

/**
 * A day's rows that can be put in order by hand: press and hold a row on a phone (or take a row's ≡ handle on a wide
 * screen), drag it up or down, and it stays where it is dropped. Only within the day — the rows of the list it wraps,
 * the ones marked with `reorderAttrs` — because moving to another day is changing the date, which is an edit.
 *
 * Pointer events alone, no drag library. A tap still opens, a sideways swipe still reveals Edit and Delete, and a
 * quick vertical move without the hold still scrolls the page: the hold has to last `HOLD_MS` with the finger nearly
 * still, and anything that moves first, or a scroll that takes the pointer away, lets go of it.
 */

const HOLD_MS = 400;
/** How far a finger may wander during the hold before it is read as a scroll or a swipe instead. */
const SLOP = 8;
/** A click straight after a drop is the drop's own release, never a tap on the row. */
const CLICK_AFTER_DROP_MS = 400;

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Where `id` goes when it is moved `by` places among `ids` (a day's movable rows): the new order, or null at an end. */
export function movedBy(ids: readonly string[], id: string, by: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** What a movable row carries, so the list finds it. Spread onto the row's `<li>`. */
export const reorderAttrs = (id: string) => ({ 'data-reorder-id': id });

interface Item {
  id: string;
  el: HTMLElement;
  top: number;
  height: number;
}

interface Drag {
  pointerId: number;
  /** Where the pointer went down, and when the row was lifted (`performance.now()`), to tell a late hold from a swipe. */
  startX: number;
  liftedAt: number;
  startY: number;
  items: Item[];
  from: number;
  to: number;
  minDy: number;
  maxDy: number;
}

export function DayReorder({
  enabled,
  phone,
  onMove,
  className,
  children,
}: {
  enabled: boolean;
  phone: boolean;
  /** The moved row and the day's movable rows in their new order. Called once per drop that changed something. */
  onMove: (movedId: string, order: string[]) => void;
  className?: string;
  children: ReactNode;
}) {
  const list = useRef<HTMLUListElement>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number; item: HTMLElement } | null>(null);
  const drag = useRef<Drag | null>(null);
  const droppedAt = useRef(0);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  /** Puts every row back where its own layout has it, at once or sliding. */
  const settle = (items: readonly Item[], animate: boolean) => {
    for (const { el } of items) {
      el.style.transition = animate && !reducedMotion() ? 'transform 150ms ease' : 'none';
      el.style.transform = '';
      el.style.boxShadow = '';
      el.style.zIndex = '';
      el.style.position = '';
      el.style.background = '';
      el.removeAttribute('data-reorder-lifted');
    }
    if (!animate) {
      // Next frame, so the reset is not itself animated when the transition comes back.
      requestAnimationFrame(() => items.forEach(({ el }) => (el.style.transition = '')));
    }
  };

  const lift = (item: HTMLElement, pointerId: number, clientX: number, clientY: number, liftedAt: number) => {
    const ul = list.current;
    if (!ul) return;
    const items: Item[] = [...ul.querySelectorAll<HTMLElement>('[data-reorder-id]')]
      .filter((el) => el.parentElement === ul)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { id: el.dataset.reorderId!, el, top: rect.top, height: rect.height };
      });
    const from = items.findIndex((it) => it.el === item);
    if (from < 0 || items.length < 2) return;
    const moved = items[from]!;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    drag.current = {
      pointerId,
      startX: clientX,
      liftedAt,
      startY: clientY,
      items,
      from,
      to: from,
      minDy: first.top - moved.top,
      maxDy: last.top + last.height - (moved.top + moved.height),
    };
    try {
      ul.setPointerCapture(pointerId);
    } catch {
      // The pointer is already gone: the drop comes from pointerup or never, and cancel cleans up.
    }
    const still = reducedMotion();
    for (const it of items) it.el.style.transition = it === moved || still ? 'none' : 'transform 150ms ease';
    moved.el.setAttribute('data-reorder-lifted', '');
    moved.el.style.position = 'relative';
    moved.el.style.zIndex = '10';
    moved.el.style.background = 'var(--ph-surface)';
    moved.el.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
    moved.el.style.transform = still ? '' : 'scale(1.02)';
    if (phone) navigator.vibrate?.(10);
  };

  const follow = (clientY: number) => {
    const d = drag.current;
    if (!d) return;
    const dy = Math.max(d.minDy, Math.min(d.maxDy, clientY - d.startY));
    const moved = d.items[d.from]!;
    const centre = moved.top + moved.height / 2 + dy;
    let to = 0;
    for (const [i, it] of d.items.entries()) if (i !== d.from && it.top + it.height / 2 < centre) to += 1;
    d.to = to;
    moved.el.style.transform = `translateY(${dy}px)${reducedMotion() ? '' : ' scale(1.02)'}`;
    // The gap: the rows between where it was and where it would land step aside by its height.
    for (const [i, it] of d.items.entries()) {
      if (i === d.from) continue;
      const shift = d.from < to && i > d.from && i <= to ? -moved.height : to < d.from && i >= to && i < d.from ? moved.height : 0;
      it.el.style.transform = shift ? `translateY(${shift}px)` : '';
    }
  };

  const drop = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    droppedAt.current = Date.now();
    if (d.to === d.from) {
      settle(d.items, true);
      return;
    }
    const ids = d.items.map((it) => it.id);
    const [movedId] = ids.splice(d.from, 1);
    ids.splice(d.to, 0, movedId!);
    // Without sliding: the list is redrawn in the new order in this same event, so the rows must stand still in it.
    settle(d.items, false);
    onMove(movedId!, ids);
  };

  const abandon = () => {
    cancelPress();
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    try {
      list.current?.releasePointerCapture(d.pointerId);
    } catch {
      // Not captured, or already released.
    }
    settle(d.items, true);
  };

  useEffect(() => abandon, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * A held finger no longer scrolls the page: the move is the row's. React's touch listeners are passive, so this one
   * is the list's own — and on it from the start, not added at the lift, because a phone decides at the touch's start
   * whether anything may cancel its scroll. It does nothing unless a row is lifted.
   */
  useEffect(() => {
    const ul = list.current;
    if (!ul || !enabled || !phone) return;
    const block = (event: TouchEvent) => {
      if (drag.current && event.cancelable) event.preventDefault();
    };
    ul.addEventListener('touchmove', block, { passive: false });
    return () => ul.removeEventListener('touchmove', block);
  }, [enabled, phone]);

  const start = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (!enabled || event.button !== 0 || drag.current) return;
    const target = event.target as Element;
    const item = target.closest<HTMLElement>('[data-reorder-id]');
    if (!item || item.parentElement !== list.current) return;
    if (target.closest('[data-reorder-handle]')) {
      // The handle lifts at once: it is there for nothing else.
      event.preventDefault();
      // Lifted as it went down: no later move is older than that.
      lift(item, event.pointerId, event.clientX, event.clientY, event.timeStamp);
      return;
    }
    if (!phone) return;
    cancelPress();
    const { pointerId, clientX, clientY } = event;
    press.current = {
      pointerId,
      x: clientX,
      y: clientY,
      item,
      timer: window.setTimeout(() => {
        const held = press.current;
        press.current = null;
        if (held) lift(held.item, held.pointerId, held.x, held.y, performance.now());
      }, HOLD_MS),
    };
  };

  return (
    <ul
      ref={list}
      className={className}
      // On a phone a long press would otherwise select the row's words or open the system's menu over it.
      style={enabled && phone ? { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' } : undefined}
      onPointerDownCapture={start}
      onPointerMoveCapture={(event) => {
        const d = drag.current;
        if (d && event.pointerId === d.pointerId) {
          // A move made before the hold ran out, delivered late by a busy page: it was a swipe or a scroll, never a drag.
          if (event.timeStamp < d.liftedAt && Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > SLOP) {
            abandon();
            return;
          }
          // The row's own swipe never sees a move that is a drag.
          event.stopPropagation();
          follow(event.clientY);
          return;
        }
        const p = press.current;
        if (p && event.pointerId === p.pointerId && Math.hypot(event.clientX - p.x, event.clientY - p.y) > SLOP) cancelPress();
      }}
      onPointerUpCapture={(event) => {
        cancelPress();
        if (drag.current && event.pointerId === drag.current.pointerId) drop();
      }}
      onPointerCancelCapture={abandon}
      onLostPointerCapture={(event) => {
        if (drag.current && event.pointerId === drag.current.pointerId) drop();
      }}
      onClickCapture={(event) => {
        if (Date.now() - droppedAt.current < CLICK_AFTER_DROP_MS) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (enabled && phone) event.preventDefault();
      }}
    >
      {children}
    </ul>
  );
}

/**
 * A wide screen's way to move a row: the ≡ handle to drag (or, focused, ↑ and ↓), and Move up and Move down for
 * anyone who would rather not drag. Shown on the row's hover or focus, like its pencil.
 */
export function ReorderControls({ description, onMove }: { description: string; onMove: (by: -1 | 1) => void }) {
  const button = 'rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-900 focus-visible:opacity-100 group-hover:opacity-100 focus-visible:outline-2 focus-visible:outline-slate-900';
  return (
    // Its own clicks are never the row's: the row's click opens the editor.
    <span className="hidden shrink-0 items-center gap-0.5 md:flex" onClick={(event) => event.stopPropagation()}>
      <button type="button" className={button} title="Move up" aria-label={`Move ${description} up`} onClick={() => onMove(-1)}>
        <ChevronUp size={16} aria-hidden />
      </button>
      <button type="button" className={button} title="Move down" aria-label={`Move ${description} down`} onClick={() => onMove(1)}>
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        data-reorder-handle=""
        title="Drag to reorder within the day"
        aria-label={`Reorder ${description}`}
        className={cx(button, 'cursor-grab touch-none active:cursor-grabbing')}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          onMove(event.key === 'ArrowUp' ? -1 : 1);
        }}
      >
        <GripVertical size={16} aria-hidden />
      </button>
    </span>
  );
}
