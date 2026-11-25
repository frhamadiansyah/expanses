import { useEffect, useRef, useState } from 'react';

/*
 * The Mac tables' column names stay on top while a long month scrolls (owner 2026-11-25): the header row sticks under
 * the title bar (`DeskBar`, 58px), filters and all, and wears a soft shadow once rows pass under it.
 */

/** How far down the window the header sticks: the title bar's height. */
export const STICKY_TOP = 58;

/** The header row's classes: stuck under the title bar on the card's own ground; the shadow while rows pass under it. */
export const stickyHead = (stuck: boolean) =>
  `sticky top-[58px] z-[6] bg-[var(--mk-card)] transition-shadow ${stuck ? 'shadow-[0_6px_10px_-6px_rgb(0_0_0/0.18)]' : ''}`;

/** Whether the header row is stuck (rows passing under it): its top at the title bar's foot with the page scrolled. */
export function useStuck<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = ref.current;
      if (!el) return;
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= STICKY_TOP + 0.5);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  return { ref, stuck };
}

/**
 * Whether a box is as wide as its table needs (`min`). A box that scrolls sideways is a scroll box of its own, which a
 * sticky header cannot stick out of; so it scrolls sideways only when it must (a window narrower than the table).
 */
export function useFits<T extends HTMLElement>(min: number) {
  const ref = useRef<T | null>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setFits(el.clientWidth >= min);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return { ref, fits };
}
