import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cx } from './index';
import { useTwoTap } from './two-tap';

const PAY_AT = 70;
/** Each round action's share of the revealed room: a 52 pt circle and the air either side of it, as Mail spaces them. */
const SLOT = 64;
/** The air at the open edge, so the last circle never touches the screen's side. */
const EDGE = 8;

/** Destructive is the alarm red, primary the app's tint, neutral the grey Mail gives More. */
export type SwipeTone = 'destructive' | 'primary' | 'neutral';

const TONE: Record<SwipeTone, string> = {
  destructive: 'bg-[var(--ph-alarm)]',
  primary: 'bg-[var(--ph-tint)]',
  neutral: 'bg-[#8e8e93]',
};

/** One action behind a row's left edge: a filled circle with a white icon, and its word in small grey under it. */
export interface SwipeAction {
  /** The word under the circle. It is the button's accessible name unless `name` says more. */
  label: string;
  icon: LucideIcon;
  tone: SwipeTone;
  onPress: () => void;
  /** The accessible name, when the word alone would not say which row it acts on ("Skip Netflix"). */
  name?: string;
  title?: string;
  disabled?: boolean;
  /** Asked twice: what the word reads once the first tap has armed it ("Delete?"). The second tap calls `onPress`. */
  confirm?: string;
}

/** What the ground under a right drag shows while it is under way — the action letting go past the threshold does. */
export interface SwipeHint {
  label: string;
  icon: LucideIcon;
  tone?: SwipeTone;
}

/** The circle and its word: the face every swipe in the app shows, whichever way it was dragged. */
function RoundFace({ icon: Icon, tone, label }: { icon: LucideIcon; tone: SwipeTone; label: string }) {
  return (
    <>
      <span
        aria-hidden
        className={cx('flex aspect-square shrink-0 items-center justify-center rounded-full text-white', TONE[tone])}
        // As large as Mail's 52 pt, or as large as a short row leaves room for under its word.
        style={{ height: 'min(52px, calc(100% - 16px))', minHeight: 28 }}
      >
        <Icon size={22} strokeWidth={2} />
      </span>
      <span className="text-[11px] leading-[12px] font-medium whitespace-nowrap text-[var(--ph-ink-3)]">{label}</span>
    </>
  );
}

function RoundAction({ action }: { action: SwipeAction }) {
  // Always called, used only when the action asks twice: one mechanism with the receipt's two-tap delete.
  const twoTap = useTwoTap(action.onPress);
  const armed = Boolean(action.confirm) && twoTap.armed;
  return (
    <button
      type="button"
      disabled={action.disabled}
      title={action.title}
      // An armed question is named by what it asks, as it was when the word was the whole button.
      aria-label={armed ? undefined : action.name}
      onBlur={action.confirm ? twoTap.onBlur : undefined}
      onClick={action.confirm ? twoTap.onClick : action.onPress}
      className="flex h-full flex-col items-center justify-center gap-[2px] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
      style={{ width: SLOT }}
    >
      <RoundFace icon={action.icon} tone={action.tone} label={armed ? action.confirm! : action.label} />
    </button>
  );
}

/**
 * A row that slides: right past a threshold calls onSwipeRight, left reveals the actions behind it. A tap is a tap —
 * the row's own button handles it — and a drag never also counts as a tap.
 *
 * Every swipe in the app draws the same way, as iOS Mail does: round filled buttons with a white icon and a small
 * grey word, standing on the page's ground rather than a coloured slab, while the row slides over them as a card
 * with rounded edges. Callers describe their actions; none draws its own.
 */
export function SwipeRow({
  children,
  enabled,
  onSwipeRight,
  rightHint,
  actions,
  className,
  testId,
}: {
  children: (suppressClick: () => boolean) => ReactNode;
  enabled: boolean;
  onSwipeRight?: () => void;
  rightHint?: SwipeHint;
  /** What a left drag reveals, in order from the row's edge outwards. Empty or absent: the row does not slide left. */
  actions?: readonly SwipeAction[];
  className?: string;
  testId?: string;
}) {
  const shown = actions ?? [];
  // How far left the row slides to stand open — as wide as the actions behind it.
  const reveal = shown.length * SLOT + EDGE;
  const openAt = Math.round(reveal * 0.66);
  const [x, setXState] = useState(0);
  // The latest offset, for the release: a pointerup can arrive before React has rendered the last move.
  const offset = useRef(0);
  const setX = (next: number) => {
    offset.current = next;
    setXState(next);
  };
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; base: number; moved: boolean; pointer: number } | null>(null);
  const dragged = useRef(false);
  const canRight = enabled && Boolean(onSwipeRight);
  const canLeft = enabled && shown.length > 0;

  return (
    // The test id goes here, on the element holding both the action layer and the row content, so a locator
    // scoped to the row reaches the buttons behind it as well as what is written on its face.
    <div data-testid={testId} className={cx('relative overflow-hidden', className)}>
      {x !== 0 && (
        <div className="absolute inset-0 flex items-stretch justify-between bg-[var(--ph-ground)]">
          <div className="flex items-stretch" style={{ paddingLeft: EDGE }}>
            {x > 0 && rightHint && (
              <span className="flex h-full flex-col items-center justify-center gap-[2px]" style={{ width: SLOT }}>
                <RoundFace icon={rightHint.icon} tone={rightHint.tone ?? 'primary'} label={rightHint.label} />
              </span>
            )}
          </div>
          <div className="flex items-stretch" style={{ paddingRight: EDGE }}>
            {x < 0 && shown.map((action) => <RoundAction key={action.label} action={action} />)}
          </div>
        </div>
      )}
      <div
        className={cx('relative bg-white', !dragging && 'transition-transform duration-150', x !== 0 && 'overflow-hidden rounded-[12px]')}
        style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          dragged.current = false;
          if (!enabled) return;
          drag.current = { startX: e.clientX, startY: e.clientY, base: offset.current, moved: false, pointer: e.pointerId };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          if (!d.moved) {
            // Mostly vertical is a scroll, and a few pixels is a shaky tap: neither moves the row.
            if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(e.clientY - d.startY)) return;
            d.moved = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(d.pointer);
          }
          let next = d.base + dx;
          if (!canRight) next = Math.min(next, 0);
          if (!canLeft) next = Math.max(next, 0);
          setX(Math.max(-reveal - 34, Math.min(110, next)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (!d?.moved) {
            // A tap on a row left open closes it, and does nothing else.
            if (offset.current !== 0) {
              dragged.current = true;
              setX(0);
            }
            return;
          }
          dragged.current = true;
          const released = offset.current;
          if (released > PAY_AT && canRight) {
            setX(0);
            onSwipeRight!();
          } else setX(released < -openAt && canLeft ? -reveal : 0);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setX(0);
        }}
      >
        {children(() => {
          const was = dragged.current;
          dragged.current = false;
          return was;
        })}
      </div>
    </div>
  );
}
