import { useEffect, useSyncExternalStore } from 'react';
import { ToastCard, type ToastIcon } from './UndoToast';

/**
 * A short line saying what was just done, shown from anywhere and kept on screen across a navigation: the screen that
 * did the work is usually the one that closes. It goes by itself after four seconds. (`UndoToast` is the one with a
 * way back; this is for what has no undo.)
 */
let current: { id: number; text: string; icon?: ToastIcon } | null = null;
let next = 1;
const listeners = new Set<() => void>();

export function showToast(text: string, icon?: ToastIcon): void {
  current = { id: next++, text, ...(icon ? { icon } : {}) };
  for (const listener of listeners) listener();
}

function clearToast(id: number): void {
  if (current?.id !== id) return;
  current = null;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => current;

/** Mounted once, in the app's layout. */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => clearToast(toast.id), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return <ToastCard {...(toast.icon ? { icon: toast.icon } : {})} text={toast.text} aria-live="polite" data-testid="toast" />;
}
