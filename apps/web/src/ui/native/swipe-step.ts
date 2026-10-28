import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from 'react';
import { reducedMotion } from './card-motion';

/** How far a drag must go sideways before it changes the card. */
const COMMIT_PX = 44;
/** How far sideways a pointer must move, more than it moves up or down, before the gesture is a swipe at all. */
const INTENT_PX = 8;
const OUT_MS = 90;
const IN_MS = 150;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** The card follows the finger at a fraction of the distance, and never far. */
const follow = (dx: number) => Math.max(-90, Math.min(90, dx * 0.6));

/**
 * A horizontal swipe that steps through a row of items — here the plastic cards of one account.
 *
 * The element follows the finger a little while it is dragged, and past the threshold slides out, the item changes,
 * and the new one slides in from the other side. Put the returned handlers on the thing that is touched and give
 * `target` the element that moves; the thing touched should have `touch-action: pan-y`, so a vertical drag still
 * scrolls the page and never reaches the swipe.
 *
 * A drag is not a tap: `swiped()` answers true once for the click that follows one, so a card that closes on tap or
 * turns over on tap does neither at the end of a swipe. With reduced motion the item changes at once, nothing slides.
 * `onStep` answers whether there was an item to step to.
 */
export function useSwipeStep({ enabled, onStep, target }: { enabled: boolean; onStep: (by: 1 | -1) => boolean; target: () => HTMLElement | null }) {
  const start = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const dragged = useRef(false);
  const busy = useRef(false);

  const settle = useCallback((node: HTMLElement | null, from: number) => {
    if (!node) return;
    node.style.transform = '';
    if (reducedMotion() || typeof node.animate !== 'function') return;
    node.animate([{ transform: `translateX(${from}px)` }, { transform: 'translateX(0)' }], { duration: IN_MS, easing: EASE_OUT });
  }, []);

  const commit = useCallback(
    (by: 1 | -1, node: HTMLElement | null, dx: number) => {
      if (!node || reducedMotion() || typeof node.animate !== 'function') {
        if (node) node.style.transform = '';
        onStep(by);
        return;
      }
      busy.current = true;
      // Out to the side the finger went, then the change, then the next item in from the other side.
      const out = by === 1 ? -56 : 56;
      node
        .animate(
          [
            { transform: `translateX(${dx}px)`, opacity: 1 },
            { transform: `translateX(${out}px)`, opacity: 0.2 },
          ],
          { duration: OUT_MS, easing: 'ease-in', fill: 'forwards' },
        )
        .finished.catch(() => undefined)
        .then(() => {
          const changed = onStep(by);
          node.getAnimations().forEach((animation) => animation.cancel());
          node.style.transform = '';
          if (changed) {
            node.animate(
              [
                { transform: `translateX(${-out}px)`, opacity: 0.2 },
                { transform: 'translateX(0)', opacity: 1 },
              ],
              { duration: IN_MS, easing: EASE_OUT },
            );
          }
        })
        .finally(() => {
          busy.current = false;
        });
    },
    [onStep],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      dragged.current = false;
      if (!enabled || busy.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.id !== event.pointerId) return;
      const dx = event.clientX - s.x;
      const dy = event.clientY - s.y;
      if (!s.dragging) {
        if (Math.abs(dx) < INTENT_PX || Math.abs(dx) <= Math.abs(dy)) return;
        s.dragging = true;
        dragged.current = true;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* a pointer that has gone has nothing to capture */
        }
      }
      const node = target();
      if (node) node.style.transform = `translateX(${follow(dx)}px)`;
    },
    [target],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const s = start.current;
      if (!s || s.id !== event.pointerId) return;
      start.current = null;
      if (!s.dragging) return;
      const dx = event.clientX - s.x;
      const node = target();
      if (!cancelled && Math.abs(dx) >= COMMIT_PX) commit(dx < 0 ? 1 : -1, node, follow(dx));
      else settle(node, follow(dx));
    },
    [commit, settle, target],
  );

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
  };
  /** True once for the click that ends a swipe. */
  const swiped = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);
  return { handlers, swiped };
}
