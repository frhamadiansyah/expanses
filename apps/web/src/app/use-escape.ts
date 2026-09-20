import { useEffect, useRef } from 'react';

/**
 * What is currently listening for Escape, innermost last.
 *
 * A sheet and the keypad inside it both used to hear Escape on `document` and both used to act on it: one press
 * put the dock away *and* closed the form behind it, taking a half-typed transaction with it. Escape closes the
 * innermost thing only — the dock, then the sheet, then the screen — so it is always an undo of the last step
 * and never of the whole form.
 */
const stack: { close: () => void }[] = [];

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  stack[stack.length - 1]?.close();
}

/**
 * Close this on Escape, but only while it is the innermost thing open.
 *
 * `enabled` is a parameter rather than a reason to skip the call, so the hook order stays the same on every
 * render: a keypad that is not on screen must not take Escape away from the sheet it sits in.
 */
export function useEscape(onEscape: () => void, enabled = true) {
  // The handler is read at the moment of the press, so a fresh closure each render does not re-order the stack.
  const latest = useRef(onEscape);
  latest.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    const entry = { close: () => latest.current() };
    stack.push(entry);
    if (stack.length === 1) document.addEventListener('keydown', onKey);
    return () => {
      const at = stack.lastIndexOf(entry);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) document.removeEventListener('keydown', onKey);
    };
  }, [enabled]);
}
