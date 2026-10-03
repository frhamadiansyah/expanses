import type { DraftRow } from '@expanses/db';
import { Minus, Plus, X } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../../app/use-escape';
import { captureBytes, native } from '../../capture/native';
import { fieldBoxes, type ReadingWithLines } from './capture-view';

const MAX_SCALE = 6;

interface View {
  scale: number;
  x: number;
  y: number;
}

/**
 * One capture, full screen: the picture the reading came from, with a box around everything that was read.
 *
 * It exists because a wrong figure is easiest to see against what it was read from. The picture is fetched from
 * the phone's own storage through the capture bridge — no URL, no copy anywhere — and shown with the line boxes
 * the reader wrote down. A notification has no picture, so it shows its own words instead; either way nothing
 * here is editable — correcting happens on the sheet behind, and it is the correction that teaches the source.
 *
 * Pinch or scroll to zoom, drag to move, double-tap to step between "the whole thing" and "close enough to read".
 * `focus` — the field whose row was tapped — starts the view centred on that box.
 */
export function CaptureViewer({
  draft,
  reading,
  focus,
  onClose,
}: {
  draft: DraftRow;
  reading: ReadingWithLines | null;
  /** The field to open centred on, when the viewer was opened from a field's row. */
  focus: 'amount' | 'name' | 'date' | null;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; midX: number; midY: number; view: View } | null>(null);

  // WebKit's own pinch (page zoom) would take the two fingers before the picture sees them.
  useEffect(() => {
    const stop = (event: Event) => event.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);

  // The bytes come from the phone's private capture folder; the object URL is this page's own view of them.
  useEffect(() => {
    if (!draft.imageFile) return;
    let cancelled = false;
    let url: string | null = null;
    void native
      .readCaptureImage({ file: draft.imageFile })
      .then(({ base64, mime }) => {
        url = URL.createObjectURL(new Blob([captureBytes(base64)], { type: mime }));
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [draft.imageFile]);

  // Opened from a field: start close, with that box in the middle of the screen.
  useEffect(() => {
    if (!src || !focus) return;
    const wanted = fieldBoxes(reading).find((box) => box.field === focus);
    if (!wanted || !stage.current) return;
    const [x, y, width, height] = wanted.box;
    setView({
      scale: 2.5,
      x: (0.5 - (x + width / 2)) * stage.current.clientWidth * 2.5,
      y: (0.5 - (y + height / 2)) * stage.current.clientHeight * 2.5,
    });
  }, [src, focus, reading]);

  const zoomBy = (factor: number) =>
    setView((current) => ({ ...current, scale: Math.min(MAX_SCALE, Math.max(1, current.scale * factor)) }));

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const [one, two] = [...pointers.current.values()];
      gesture.current = {
        distance: Math.hypot(one!.x - two!.x, one!.y - two!.y),
        midX: (one!.x + two!.x) / 2,
        midY: (one!.y + two!.y) / 2,
        view,
      };
    }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = pointers.current.get(event.pointerId)!;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && gesture.current) {
      const [one, two] = [...pointers.current.values()];
      const distance = Math.hypot(one!.x - two!.x, one!.y - two!.y);
      const scale = Math.min(MAX_SCALE, Math.max(1, (gesture.current.view.scale * distance) / gesture.current.distance));
      setView({
        scale,
        x: gesture.current.view.x * (scale / gesture.current.view.scale) + ((one!.x + two!.x) / 2 - gesture.current.midX),
        y: gesture.current.view.y * (scale / gesture.current.view.scale) + ((one!.y + two!.y) / 2 - gesture.current.midY),
      });
      return;
    }
    if (view.scale > 1) {
      setView((current) => ({ ...current, x: current.x + event.clientX - before.x, y: current.y + event.clientY - before.y }));
    }
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  }

  const boxes = fieldBoxes(reading);

  /*
   * On the document's body, not inside the page: a sheet or a screen that moves (a transform) would otherwise hold
   * a "fixed" layer inside itself, and the top bar would sit under the phone's status bar where nothing can be tapped.
   */
  return createPortal(
    <div
      role="dialog"
      aria-label={`What was read from ${draft.description}`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onWheel={(event) => zoomBy(event.deltaY < 0 ? 1.1 : 0.9)}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <span className="min-w-0 truncate text-[15px] font-semibold">{draft.description}</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="ph-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      {draft.imageFile && src && (
        <div
          className="relative flex-1 touch-none overflow-hidden"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={() => (view.scale > 1.05 ? setView({ scale: 1, x: 0, y: 0 }) : zoomBy(2.5))}
        >
          <div className="flex h-full w-full items-center justify-center">
            <div
              ref={stage}
              className="relative"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            >
              <img src={src} alt="" className="max-h-[70vh] max-w-[92vw] select-none object-contain" draggable={false} />
              {boxes.map((box) => {
                const [x, y, width, height] = box.box;
                const chosen = box.field === focus;
                return (
                  <div
                    key={box.field}
                    className={chosen ? 'absolute border-2 border-[var(--ph-tint)]' : 'absolute border border-white/80'}
                    style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}
                  >
                    <span
                      className={
                        chosen
                          ? 'absolute -top-[20px] left-0 whitespace-nowrap rounded bg-[var(--ph-tint)] px-1 text-[11px] font-semibold'
                          : 'absolute -top-[20px] left-0 whitespace-nowrap rounded bg-white/90 px-1 text-[11px] font-semibold text-black'
                      }
                    >
                      {box.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {draft.imageFile && !src && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[14px] text-white/70">
          {failed ? 'That picture is not on this phone any more.' : 'Opening the picture…'}
        </div>
      )}

      {!draft.imageFile && (
        <div className="flex-1 overflow-auto px-6 py-4">
          <p className="mb-1 text-[12.5px] uppercase tracking-wide text-white/50">The notification said</p>
          <p className="whitespace-pre-wrap text-[15px] leading-6">{draft.rawPayload ?? draft.description}</p>
        </div>
      )}

      <div className="px-4 pt-2" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        {draft.imageFile && src && (
          <div className="mb-3 flex items-center justify-center gap-3">
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)} className="ph-focus flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
              <Minus size={20} aria-hidden />
            </button>
            <button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })} className="ph-focus h-11 rounded-full bg-white/15 px-5 text-[15px] font-semibold">
              Fit
            </button>
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.5)} className="ph-focus flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
              <Plus size={20} aria-hidden />
            </button>
          </div>
        )}
        <p className="mb-3 text-center text-[12.5px] text-white/50">
          {draft.imageFile ? 'Pinch to zoom · drag to move · double-tap to fit' : 'Correcting a field happens on the screen behind this view'}
        </p>
        <button type="button" onClick={onClose} className="ph-focus min-h-11 w-full rounded-full bg-white text-[15px] font-semibold text-black">
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
