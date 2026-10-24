import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cx } from './index';
import { useTwoTap } from './two-tap';

const PAY_AT = 70;
/** Each round action's share of the revealed room: a 34 pt circle and the air either side of it. */
const SLOT = 48;
/** The air at the open edge, so the last circle never touches the screen's side. */
const EDGE = 8;
/**
 * The circle: 34 pt, or less on a row too short to leave 8 pt of air above and below it. A row is rarely taller than
 * ~52 pt, so the action carries no word under its circle — the icon says it, and the button's name says it aloud.
 */
const CIRCLE = { height: 'min(34px, calc(100% - 16px))', minHeight: 24 } as const;

/** Destructive is the alarm red, primary the app's tint, neutral the grey Mail gives More. */
export type SwipeTone = 'destructive' | 'primary' | 'neutral';

const TONE: Record<SwipeTone, string> = {
  destructive: 'bg-[var(--ph-alarm)]',
  primary: 'bg-[var(--ph-tint)]',
  neutral: 'bg-[#8e8e93]',
};

/** One action behind a row's left edge: a filled circle with a white icon. */
export interface SwipeAction {
  /** What the action is called: the button's accessible name unless `name` says more. Not drawn. */
  label: string;
  icon: LucideIcon;
  tone: SwipeTone;
  onPress: () => void;
  /** The accessible name, when the label alone would not say which row it acts on ("Skip Netflix"). */
  name?: string;
  title?: string;
  disabled?: boolean;
  /**
   * Asked twice: what the action reads once the first tap has armed it ("Delete?"). Armed, the circle widens into a
   * pill across the revealed room with these words on it, as Mail's confirm does; the second tap calls `onPress`.
   */
  confirm?: string;
}

/** What the ground under a right drag shows while it is under way — the action letting go past the threshold does. */
export interface SwipeHint {
  label: string;
  icon: LucideIcon;
  tone?: SwipeTone;
}

/** The circle: the face every swipe in the app shows, whichever way it was dragged. */
function RoundFace({ icon: Icon, tone }: { icon: LucideIcon; tone: SwipeTone }) {
  return (
    <span aria-hidden className={cx('flex aspect-square shrink-0 items-center justify-center rounded-full text-white', TONE[tone])} style={CIRCLE}>
      <Icon size={18} strokeWidth={2.25} />
    </span>
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
      // Named by its label, or by what it asks once armed — "Delete", then "Delete?" — as when the word was the button.
      aria-label={armed ? action.confirm : (action.name ?? action.label)}
      onBlur={action.confirm ? twoTap.onBlur : undefined}
      onClick={action.confirm ? twoTap.onClick : action.onPress}
      className={cx(
        'flex h-full items-center justify-center disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900',
        // Armed, it covers the whole revealed room, over the actions beside it: the question is the only thing left.
        armed && 'absolute inset-y-0 right-0 left-0 z-10 bg-[var(--ph-surface)] px-[6px]',
      )}
      style={armed ? undefined : { width: SLOT }}
    >
      {armed ? (
        <span
          className={cx('flex w-full items-center justify-center rounded-full text-[15px] font-semibold whitespace-nowrap text-white', TONE[action.tone])}
          style={CIRCLE}
        >
          {action.confirm}
        </span>
      ) : (
        <RoundFace icon={action.icon} tone={action.tone} />
      )}
    </button>
  );
}

/**
 * A row that slides: right past a threshold calls onSwipeRight, left reveals the actions behind it. A tap is a tap —
 * the row's own button handles it — and a drag never also counts as a tap.
 *
 * Every swipe in the app draws the same way, as iOS Mail does: round filled buttons with a white icon, with air above
 * and below, on the row's own surface rather than a coloured slab, while the row slides flat off to the side. Callers
 * describe their actions; none draws its own.
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
        <div className="absolute inset-0 flex items-stretch justify-between bg-[var(--ph-surface)]">
          <div className="flex items-stretch" style={{ paddingLeft: EDGE }}>
            {x > 0 && rightHint && (
              <span className="flex h-full items-center justify-center" style={{ width: SLOT }}>
                <RoundFace icon={rightHint.icon} tone={rightHint.tone ?? 'primary'} />
              </span>
            )}
          </div>
          <div className="relative flex items-stretch" style={{ paddingRight: EDGE }}>
            {x < 0 && shown.map((action) => <RoundAction key={action.label} action={action} />)}
          </div>
        </div>
      )}
      <div
        className={cx('relative bg-white', !dragging && 'transition-transform duration-150')}
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
