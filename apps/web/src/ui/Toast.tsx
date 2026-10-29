import { useEffect, useSyncExternalStore } from 'react';

/**
 * A short line saying what was just done, shown from anywhere and kept on screen across a navigation: the screen that
 * did the work is usually the one that closes. It goes by itself after four seconds. (`UndoToast` is the one with a
 * way back; this is for what has no undo.)
 */
let current: { id: number; text: string } | null = null;
let next = 1;
const listeners = new Set<() => void>();

export function showToast(text: string): void {
  current = { id: next++, text };
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
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg md:bottom-6"
    >
      {toast.text}
    </div>
  );
}
