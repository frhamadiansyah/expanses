import { useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * What a page was showing when it was left, kept for as long as the app is open and handed back on Back.
 *
 * Component state dies with the page, so a list opened to a row and gone back to came up shut and at the top. The
 * memory is keyed by the history entry, not the address: Back returns to the same entry and finds its drawers and
 * place; a fresh visit to the same page is a new entry and starts shut, as a page that opens itself would hide the
 * answer it folds away.
 */
const memory = new Map<string, unknown>();
const LIMIT = 200;

function remember(key: string, value: unknown) {
  memory.delete(key);
  memory.set(key, value);
  // Entries are small, but a long session should not grow without end: the oldest go first.
  if (memory.size > LIMIT) memory.delete(memory.keys().next().value as string);
}

/** The history entry the page is drawn for; Back to it gives the same key. */
export function useEntryKey(): string {
  return useRouterState({ select: (state) => String((state.location.state as { __TSR_key?: string } | undefined)?.__TSR_key ?? state.location.href) });
}

/** State that survives leaving and coming Back to this history entry. With no `name` it is plain state. */
export function useRemembered<T>(name: string | undefined, initial: () => T): [T, (next: T | ((was: T) => T)) => void] {
  const entry = useEntryKey();
  const key = name === undefined ? null : `${entry}|${name}`;
  const [value, setValue] = useState<T>(() => (key !== null && memory.has(key) ? (memory.get(key) as T) : initial()));
  const set = useCallback(
    (next: T | ((was: T) => T)) => {
      setValue((was) => {
        const now = typeof next === 'function' ? (next as (was: T) => T)(was) : next;
        if (key !== null) remember(key, now);
        return now;
      });
    },
    [key],
  );
  return [value, set];
}

/**
 * Puts the window back where it was when this entry was left, once the page has what it needs to be that tall.
 * The place is read as the page scrolls, because by the time it unmounts the next page may already have moved it.
 */
export function useScrollMemory(name: string, ready: boolean): void {
  const entry = useEntryKey();
  const key = `${entry}|scroll:${name}`;
  const [restored, setRestored] = useState(false);
  useLayoutEffect(() => {
    if (!ready || restored) return;
    const at = memory.get(key);
    if (typeof at === 'number' && at > 0) window.scrollTo(0, at);
    setRestored(true);
  }, [ready, restored, key]);
  useEffect(() => {
    if (!restored) return;
    const onScroll = () => remember(key, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [restored, key]);
}
