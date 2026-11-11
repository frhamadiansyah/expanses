import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ErrorBox } from '../../ui';
import { useKeyboardInset } from '../../ui/native/KeyboardStrip';
import { lineState, registerLineOpener, setLineState, useLineState } from './cashflow-line-store';
import { NoteSuggestions } from './NoteSuggestions';
import { useOneLine } from './use-one-line';

/** How long the row just saved stays lit in the list. */
const FLASH_MS = 1600;
/** A tap this soon after the field opened is the hold's own release landing on the page, not a tap outside. */
const OPEN_GRACE_MS = 450;
/** How far a finger drags down on the field before it reads as putting the keyboard away. */
const SWIPE_DOWN_PX = 24;
/** Room kept over the day's group when it is scrolled into view: the status bar's glass and a little air. */
const HEADROOM = 96;
/** Room the dashed row takes under the day's head, and the suggestions' strip over the field. */
const ROW_ROOM = 72;
const STRIP_ROOM = 48;

/**
 * One line on Cashflow: what a held ＋ opens there (Settings › Default's One line). The page stays as it is; the field
 * docks on top of the keyboard, the suggested notes over it, and while something is typed the line is drawn as a dashed
 * row at the top of the day it will land on — in `slot`, which the list puts there (`useLineState().day` tells it
 * which). The keyboard's Done saves (`useOneLine`'s save, the same as `/transactions/line`); the saved row is lit in
 * the list, the field empties and the keyboard stays for the next. A drag down on the field, a tap outside it, or the
 * keyboard put away closes it, and the tab bar comes back. What was typed and not saved waits in the field.
 */
export function CashflowLine({ slot }: { slot: HTMLElement | null }) {
  const line = useOneLine();
  const { open } = useLineState();
  const inset = useKeyboardInset();
  const { field, preview, text } = line;
  const typed = text.trim().length > 0;
  const composer = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const openedAt = useRef(0);
  const swipeFrom = useRef<number | null>(null);
  // Read in the blur handler, which a picker opening fires: a sheet taking the focus is not the field being put away.
  const picking = useRef(line.picking);
  picking.current = line.picking;

  // Opened from the tab bar's release: drawn at once and focused inside the same gesture, so the keyboard comes up.
  useEffect(
    () =>
      registerLineOpener(() => {
        openedAt.current = Date.now();
        flushSync(() => setLineState({ open: true }));
        field.current?.focus();
      }),
    [field],
  );

  const close = () => {
    setLineState({ open: false, day: null });
    field.current?.blur();
  };

  // Where the line lands, for the list to put the dashed row's place at the top of that day.
  useEffect(() => {
    setLineState({ day: open && typed ? preview.occurredOn : null });
  }, [open, typed, preview.occurredOn]);

  // The day's group brought into view above the field and its suggestions when the line first reads as something:
  // with the keyboard up, Today can sit under it, below the chart.
  useEffect(() => {
    if (!open || !typed || !slot) return;
    const view = window.visualViewport;
    const top = view?.offsetTop ?? 0;
    const visible = (view?.height ?? window.innerHeight) - height - STRIP_ROOM;
    const at = slot.getBoundingClientRect().top - top;
    if (at < HEADROOM || at + ROW_ROOM > visible) window.scrollBy({ top: at - HEADROOM, behavior: 'smooth' });
  }, [open, typed, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tall as it stands (an error line makes it taller), so the suggested notes sit on top of it.
  useLayoutEffect(() => {
    const element = composer.current;
    if (!open || !element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  // A tap anywhere but the field, its row, its suggestions or a picker's sheet puts it away.
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (Date.now() - openedAt.current < OPEN_GRACE_MS || picking.current !== null) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (composer.current?.contains(target) || slot?.contains(target)) return;
      if (target.closest('[role="dialog"], [role="listbox"][aria-label="Suggested notes"]')) return;
      close();
    };
    document.addEventListener('click', outside, true);
    return () => document.removeEventListener('click', outside, true);
  }, [open, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  async function done() {
    // Done on an empty field is the keyboard put away.
    if (!typed) {
      close();
      return;
    }
    const saved = await line.save();
    if (!saved) return;
    setLineState({ flashId: saved.id });
    setTimeout(() => {
      if (lineState().flashId === saved.id) setLineState({ flashId: null });
    }, FLASH_MS);
  }

  if (!open) return null;

  return (
    <>
      {/* Room under the list for the keyboard and the field, so Today can still be scrolled up above them. */}
      <div aria-hidden style={{ height: inset + height }} />
      {typed &&
        slot &&
        createPortal(
          <ul
            // The field keeps the focus through a tap on the row: its parts open pickers, which take the focus themselves.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            className="-mx-2 mb-1 rounded-[10px] bg-[var(--ph-tint-panel)] px-2 outline-[1.5px] -outline-offset-2 outline-[var(--ph-tint)] outline-dashed" data-testid="line-ghost">
            {line.previewNode()}
          </ul>,
          slot,
        )}
      <div
        ref={composer}
        data-testid="line-composer"
        className="fixed inset-x-0 z-50 border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)] px-2 pt-1.5 pb-2 md:hidden"
        style={{
          bottom: inset,
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
          paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          // With no keyboard up (a browser with a hardware keyboard) it keeps clear of the home indicator.
          paddingBottom: inset === 0 ? 'calc(0.5rem + env(safe-area-inset-bottom))' : undefined,
        }}
        onTouchStart={(event) => {
          swipeFrom.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchMove={(event) => {
          const from = swipeFrom.current;
          const now = event.touches[0]?.clientY;
          if (from === null || now === undefined || now - from < SWIPE_DOWN_PX) return;
          swipeFrom.current = null;
          close();
        }}
        onTouchEnd={() => {
          swipeFrom.current = null;
        }}
      >
        {line.error ? (
          <div className="pb-1.5">
            <ErrorBox error={line.error} />
          </div>
        ) : null}
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void done();
          }}
        >
          <input
            ref={field}
            aria-label="One line"
            placeholder={line.saved.length > 0 ? 'Next one' : 'Shop, amount, how it was paid'}
            enterKeyHint="done"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(event) => line.type(event.target.value)}
            onBlur={() => {
              // A picker's sheet took the focus; it hands it back when it closes.
              if (picking.current !== null) return;
              close();
            }}
            className="block h-11 w-full rounded-[10px] bg-[var(--ph-surface)] px-3 text-[17px] text-[var(--ph-ink)] ring-2 ring-[var(--ph-tint)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
          />
        </form>
      </div>
      <NoteSuggestions typed={line.reading.description} kind="expense" open lift={height} categoryName={line.categoryOf} onPick={(s) => void line.pickSuggestion(s)} />
      {line.pickers}
    </>
  );
}
