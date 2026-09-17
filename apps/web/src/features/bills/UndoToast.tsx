import { useEffect } from 'react';

/** A short line saying what was just done, with the way back. It goes by itself after four seconds. */
export function UndoToast({ text, onUndo, onDone }: { text: string; onUndo: () => void; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 4000);
    return () => window.clearTimeout(timer);
  }, [text, onDone]);
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg md:bottom-6"
    >
      <span>{text}</span>
      <button type="button" onClick={onUndo} className="min-h-11 px-2 font-semibold text-emerald-300">
        Undo
      </button>
    </div>
  );
}
