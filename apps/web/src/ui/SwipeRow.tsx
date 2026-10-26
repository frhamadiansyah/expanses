import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { cx } from './index';

const PAY_AT = 70;
/** How far across the row a left drag must go before letting go performs the destructive action outright, as Mail's does. */
const FULL_AT = 0.6;
/** How long a released full swipe takes to carry the row off before it settles back, should the row still be there. */
const SETTLE_MS = 1200;
/** Each round action's share of the revealed room: a 34 pt circle and the air either side of it. */
const SLOT = 48;
/** The air at the open edge, so the last circle never touches the screen's side. */
const EDGE = 8;
/**
 * The circle: 34 pt, or less on a row too short to leave 8 pt of air above and below it. A row is rarely taller than
 * ~52 pt, so the action carries no word under its circle — the icon says it, and the button's name says it aloud.
 */
const CIRCLE = { height: 'min(34px, calc(100% - 16px))', minHeight: 24 } as const;

/** Destructive is the alarm red, primary the ink, neutral the grey Mail gives More. */
export type SwipeTone = 'destructive' | 'primary' | 'neutral';

const TONE: Record<SwipeTone, string> = {
  destructive: 'bg-[var(--ph-alarm)] text-white',
  primary: 'bg-[var(--ph-tint)] text-[var(--ph-surface)]',
  neutral: 'bg-[#8e8e93] text-white',
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
    <span aria-hidden className={cx('flex aspect-square shrink-0 items-center justify-center rounded-full', TONE[tone])} style={CIRCLE}>
      <Icon size={18} strokeWidth={2.25} />
    </span>
  );
}

function RoundAction({ action }: { action: SwipeAction }) {
  return (
    <button
      type="button"
      disabled={action.disabled}
      title={action.title}
      aria-label={action.name ?? action.label}
      onClick={action.onPress}
      className="flex h-full items-center justify-center disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-900"
      style={{ width: SLOT }}
    >
      <RoundFace icon={action.icon} tone={action.tone} />
    </button>
  );
}

/**
 * The destructive action, stretched across everything the row has uncovered: its circle grown into a bar, the icon
 * riding the edge nearest the row. It snaps out from the circle's place as the drag crosses the line (`swipe-snap`,
 * left out when motion is reduced) — letting go now performs it.
 */
function FullBar({ action, x }: { action: SwipeAction; x: number }) {
  const Icon = action.icon;
  return (
    <span aria-hidden data-testid="swipe-full" className="absolute inset-y-0 flex items-center" style={{ left: `calc(100% + ${x}px + 6px)`, right: EDGE }}>
      <span
        className={cx('swipe-snap flex w-full items-center rounded-full pl-[8px]', TONE[action.tone])}
        style={CIRCLE}
      >
        <Icon size={18} strokeWidth={2.25} />
      </span>
    </span>
  );
}

/**
 * A row that slides: right past a threshold calls onSwipeRight, left reveals the actions behind it. A tap is a tap —
 * the row's own button handles it — and a drag never also counts as a tap.
 *
 * Every swipe in the app draws the same way, as iOS Mail does: round filled buttons with a white icon, with air above
 * and below, on the row's own surface rather than a coloured slab, while the row slides flat off to the side. Callers
 * describe their actions; none draws its own.
 *
 * A row with a destructive action (Delete, Discard) also takes Mail's long swipe: dragged past `FULL_AT` of its width,
 * that action stretches across the room and letting go performs it outright. Nothing destructive asks twice here —
 * the caller's Undo toast is the way back. The other actions never full-swipe.
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
  // The one action a long swipe performs: the destructive one, when there is one to take.
  const full = shown.find((action) => action.tone === 'destructive' && !action.disabled) ?? null;
  const root = useRef<HTMLDivElement>(null);
  // The row's width, read as a drag starts: the long swipe's line is a share of it.
  const width = useRef(0);
  // Never inside the room the actions stand open in: a narrow row would otherwise open straight into the bar.
  const fullAt = () => Math.max(width.current * FULL_AT, reveal + 40);
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
  // Past the line, letting go performs the destructive action: the bar shows it, and the crossing is felt once.
  const stretched = full !== null && width.current > 0 && x < -fullAt();
  const wasStretched = useRef(false);

  return (
    // The test id goes here, on the element holding both the action layer and the row content, so a locator
    // scoped to the row reaches the buttons behind it as well as what is written on its face.
    <div ref={root} data-testid={testId} className={cx('relative overflow-hidden', className)}>
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
            {x < 0 && !stretched && shown.map((action) => <RoundAction key={action.label} action={action} />)}
          </div>
          {stretched && <FullBar action={full!} x={x} />}
        </div>
      )}
      <div
        className={cx('relative bg-white', dragging ? 'select-none' : 'transition-transform duration-150')}
        style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => {
          dragged.current = false;
          if (!enabled) return;
          width.current = root.current?.offsetWidth ?? 0;
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
          // A row whose destructive action can be swiped all the way goes as far as its own width; any other stops
          // a little past its actions, as it always has.
          const leftmost = full ? -width.current : -reveal - 34;
          setX(Math.max(leftmost, Math.min(110, next)));
          const past = full !== null && next < -fullAt();
          if (past && !wasStretched.current) navigator.vibrate?.(10);
          wasStretched.current = past;
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
          wasStretched.current = false;
          const released = offset.current;
          if (released > PAY_AT && canRight) {
            setX(0);
            onSwipeRight!();
          } else if (full && canLeft && released < -fullAt()) {
            // Let go past the line: the row is carried off and the action performed — no question, the Undo is the
            // caller's. Should the row still be here once it has gone (a refusal, say), it settles back shut.
            setX(-width.current);
            full.onPress();
            window.setTimeout(() => setX(0), SETTLE_MS);
          } else setX(released < -openAt && canLeft ? -reveal : 0);
        }}
        onPointerCancel={() => {
          wasStretched.current = false;
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
