import { type FormEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUp } from 'lucide-react';
import { ErrorBox } from '../../ui';
import { useKeyboardInset } from '../../ui/native/KeyboardStrip';
import { lineState, registerLineOpener, setLineState, useLineState } from './cashflow-line-store';
import { useOneLineLook } from '../account/one-line-look';
import { buzzWarning } from '../../native/haptics';
import { canSaveLine } from './one-line';
import { useOneLine } from './use-one-line';

/** How long the row just saved stays lit in the list. */
const FLASH_MS = 1600;
/** A tap this soon after the field opened is the hold's own release landing on the page, not a tap outside. */
const OPEN_GRACE_MS = 450;
/** A Return this soon after a save is a double press, not the keyboard being put away. */
const SAVE_ECHO_MS = 700;
/** How far a finger drags down on the field before it reads as putting the keyboard away. */
const SWIPE_DOWN_PX = 24;

/**
 * One line on Cashflow: what a held ＋ opens there (Settings › Default's One line). The page stays as it is and the field
 * docks on top of the keyboard, looking as Settings › Default's One line look says. Card: a white card floating over the
 * page (dimmed a little) with the line drawn as the row it will be saved as, each part a way to its picker, and the round
 * field with a send arrow under it. Plain: one flat bar with the field and the arrow alone; a save the line cannot make
 * says in one amber line what is missing. The keyboard's Done and the arrow both save (`useOneLine`'s save, the same as
 * `/transactions/line`); the saved row is lit in the list, the field empties and the keyboard stays for the next. A drag
 * down on the field, a tap outside it, or the keyboard put away closes it, and the tab bar comes back. What was typed
 * and not saved waits in the field.
 */
export function CashflowLine() {
  const line = useOneLine();
  const { open } = useLineState();
  const inset = useKeyboardInset();
  const look = useOneLineLook().data ?? 'card';
  const card = look === 'card';
  const { field, preview, text } = line;
  // What a refused save lacked, shown in the Plain look until the line changes.
  const [lacking, setLacking] = useState<string | null>(null);
  useEffect(() => setLacking(null), [text]);
  // The missing part's shake: off, then on a frame later, so a second blocked press shakes again.
  const [shaking, setShaking] = useState(false);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(shakeTimer.current), []);
  const typed = text.trim().length > 0;
  const blocked = typed && !canSaveLine(preview);
  const composer = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const openedAt = useRef(0);
  const savedAt = useRef(0);
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
    setLineState({ open: false });
    field.current?.blur();
  };

  // Tall as it stands (an error line or the preview makes it taller), so the list keeps room above it.
  useLayoutEffect(() => {
    const element = composer.current;
    if (!open || !element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, look]);

  // A tap anywhere but the field, its row or a picker's sheet puts it away; the dim behind the card is such a tap.
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (Date.now() - openedAt.current < OPEN_GRACE_MS || picking.current !== null) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (composer.current?.contains(target)) return;
      if (target.closest('[role="dialog"]')) return;
      close();
    };
    document.addEventListener('click', outside, true);
    return () => document.removeEventListener('click', outside, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function done() {
    // Done on an empty field is the keyboard put away; a second press landing just after a save is that save's echo.
    if (!typed) {
      if (Date.now() - savedAt.current < SAVE_ECHO_MS) return;
      close();
      return;
    }
    if (!canSaveLine(line.preview)) {
      if (!card) setLacking(line.preview.amountMinor === null ? 'Amount?' : 'Paid with?');
      buzzWarning();
      clearTimeout(shakeTimer.current);
      setShaking(false);
      requestAnimationFrame(() => setShaking(true));
      shakeTimer.current = setTimeout(() => setShaking(false), 400);
      return;
    }
    const saved = await line.save();
    if (!saved) return;
    savedAt.current = Date.now();
    setLineState({ flashId: saved.id });
    setTimeout(() => {
      if (lineState().flashId === saved.id) setLineState({ flashId: null });
    }, FLASH_MS);
  }

  if (!open) return null;

  const send = (
    <button
      type="button"
      aria-label="Save line"
      disabled={!line.canSave}
      data-blocked={blocked ? 'true' : undefined}
      // The field keeps the focus through a tap on the arrow, so the keyboard stays for the next line.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void done()}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)] disabled:bg-[var(--ph-ink-3)]"
    >
      <ArrowUp size={18} strokeWidth={2.5} aria-hidden />
    </button>
  );
  const input = (
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
      className={
        card
          ? 'block h-[38px] min-w-0 flex-1 rounded-[20px] bg-[var(--ph-ground)] px-3.5 text-[16px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none'
          : 'block h-[38px] min-w-0 flex-1 rounded-[20px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] px-3.5 text-[16px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none'
      }
    />
  );
  const form = (
    <form
      className="flex items-center gap-2"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void done();
      }}
    >
      {input}
      {send}
    </form>
  );
  const error = line.error ? (
    <div className="pb-1.5">
      <ErrorBox error={line.error} />
    </div>
  ) : null;
  const swipe = {
    onTouchStart: (event: React.TouchEvent) => {
      swipeFrom.current = event.touches[0]?.clientY ?? null;
    },
    onTouchMove: (event: React.TouchEvent) => {
      const from = swipeFrom.current;
      const now = event.touches[0]?.clientY;
      if (from === null || now === undefined || now - from < SWIPE_DOWN_PX) return;
      swipeFrom.current = null;
      close();
    },
    onTouchEnd: () => {
      swipeFrom.current = null;
    },
  };
  const sides = { paddingLeft: 'max(0.5rem, env(safe-area-inset-left))', paddingRight: 'max(0.5rem, env(safe-area-inset-right))' };

  return (
    <>
      {/* Room under the list for the keyboard and the field, so Today can still be scrolled up above them. */}
      <div aria-hidden style={{ height: inset + height + (card ? 8 : 0) }} />
      {card ? (
        <>
          <div aria-hidden data-testid="line-dim" className="fixed inset-0 z-[25] md:hidden" style={{ background: 'rgba(0,0,0,.14)' }} />
          <div
            ref={composer}
            data-testid="line-composer"
            data-look="card"
            className={`fixed z-50 overflow-hidden rounded-[18px] bg-[var(--ph-surface)] md:hidden${shaking ? ' line-shake' : ''}${line.picking !== null ? ' invisible' : ''}`}
            style={{
              ...sides,
              left: 8,
              right: 8,
              paddingLeft: 0,
              paddingRight: 0,
              bottom: inset + 8,
              boxShadow: '0 8px 28px rgba(0,0,0,.16)',
              marginBottom: inset === 0 ? 'env(safe-area-inset-bottom)' : undefined,
            }}
            {...swipe}
          >
            {typed && (
              <>
                <ul
                  // The field keeps the focus through a tap on the row: its parts open pickers, which take the focus themselves.
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseDown={(event) => event.preventDefault()}
                  className="px-3"
                  data-testid="line-ghost"
                >
                  {line.previewNode()}
                </ul>
                <div aria-hidden className="h-[0.5px] bg-[var(--ph-hair)]" />
              </>
            )}
            <div className="px-2.5 py-2">
              {error}
              {form}
            </div>
          </div>
        </>
      ) : (
        <div
          ref={composer}
          data-testid="line-composer"
          data-look="plain"
          className={`fixed inset-x-0 z-50 border-t-[0.5px] border-[var(--ph-hair)] px-2 pt-1.5 pb-2 md:hidden${line.picking !== null ? ' invisible' : ''}`}
          style={{
            ...sides,
            bottom: inset,
            background: 'rgba(249,249,251,.97)',
            // With no keyboard up (a browser with a hardware keyboard) it keeps clear of the home indicator.
            paddingBottom: inset === 0 ? 'calc(0.5rem + env(safe-area-inset-bottom))' : undefined,
          }}
          {...swipe}
        >
          {error}
          {lacking && (
            <p role="status" data-testid="line-lacking" className={`px-3 pb-1.5 text-[13px] text-[var(--ph-warn)]${shaking ? ' line-shake-self' : ''}`}>
              {lacking}
            </p>
          )}
          {form}
        </div>
      )}
      {line.pickers}
    </>
  );
}
