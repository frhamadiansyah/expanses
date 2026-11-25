import { useSyncExternalStore } from 'react';

/*
 * The phone's keypad (transactions/Keypad.tsx) is the app's own keyboard: a dock fixed to the foot of the screen, which
 * the browser knows nothing about. The visual viewport does not shrink for it, so `useKeyboardInset` reads 0 while it
 * is up, and a sheet made no room for it: in a sheet standing at half height the dock covered the very amount it typed
 * into (the fund Buy sheet's Amount, owner 25 Nov 2026). So the dock says how tall it stands here, and a sheet makes
 * room for it as it does for the keyboard. The field it types into carries `data-keypad-typing`, which is what a sheet
 * scrolls clear of it.
 */

/** The attribute on the figure the open dock is typing into. */
export const KEYPAD_TYPING_ATTR = 'data-keypad-typing';

const heights = new Map<symbol, number>();
const listeners = new Set<() => void>();
let current = 0;

function publish() {
  const next = Math.max(0, ...heights.values());
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** A dock standing `height` px tall from the foot of the screen; 0 or `release` once it is put away. */
export function setKeypadDock(key: symbol, height: number) {
  if (height > 0) heights.set(key, Math.round(height));
  else heights.delete(key);
  publish();
}

/** How much of the screen's foot the keypad covers now: 0 while none is open. */
export function keypadDockHeight(): number {
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The keypad's height while it is open, 0 otherwise; re-renders as it opens, closes or changes height. */
export function useKeypadDock(): number {
  return useSyncExternalStore(subscribe, keypadDockHeight, () => 0);
}
