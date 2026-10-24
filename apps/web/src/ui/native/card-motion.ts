/**
 * How a Wallet card moves: Apple Wallet's spring, and the hand-off that lets a card fly between layouts.
 *
 * Wallet moves a card on a spring — fast off the mark, easing in, with the barest settle past its place — rather than
 * on a fixed curve. The spring is sampled here into keyframes, so every engine plays the same curve and the
 * compositor plays it on its own: a run of plain keyframes on `transform` is what Core Animation takes over whole,
 * where a `linear()` easing is newer than some of the phones the app runs on and is not certain to leave the main
 * thread. Pure maths, apart from the hand-off store and the one media query.
 */

/** Wallet's beat for a card moving: about half a second, and settled inside it. */
export const MOVE_MS = 560;
/** How far behind the moving card the rest of the pile follows, and the step between them. */
export const PILE_LAG_MS = 24;
export const PILE_STAGGER_MS = 14;

/**
 * The spring: `response` is the period in seconds an undamped spring would swing at; `damping` is its ratio to
 * critical, just under 1 for a settle of about one per cent past the mark — a card's few pixels, not a bounce.
 */
export interface Spring {
  response: number;
  damping: number;
}
export const WALLET_SPRING: Spring = { response: 0.45, damping: 0.82 };

/** Where a spring released from 0 towards 1 is after `t` seconds. */
export function springAt(t: number, { response, damping }: Spring = WALLET_SPRING): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const decay = damping * omega;
  const swing = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-decay * t) * (Math.cos(swing * t) + (decay / swing) * Math.sin(swing * t));
}

/**
 * The spring sampled at `steps` even points over `ms`, ending exactly on 1 — the progress each keyframe stands at.
 * Thirty steps over 560 ms is a keyframe a frame, so the straight lines between them never show.
 */
export function springProgress(ms = MOVE_MS, steps = 30, spring: Spring = WALLET_SPRING): number[] {
  const out: number[] = [];
  for (let i = 0; i <= steps; i += 1) out.push(i === steps ? 1 : springAt(((i / steps) * ms) / 1000, spring));
  return out;
}

/** A place a card can be drawn at, relative to its own box: a shift and a scale from its top-left corner. */
export interface Pose {
  x: number;
  y: number;
  scale: number;
}

export const poseTransform = ({ x, y, scale }: Pose): string => (x === 0 && y === 0 && scale === 1 ? 'none' : `translate(${round(x)}px, ${round(y)}px) scale(${round(scale, 4)})`);

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The keyframes that carry a card from one pose to another on the spring: every keyframe the same transform shape,
 * so the engine interpolates them as a list rather than as matrices, and `opacity`, when given, held throughout.
 */
export function flightKeyframes(from: Pose, to: Pose, progress: readonly number[] = springProgress(), opacity?: number): Keyframe[] {
  return progress.map((p, i) => {
    const frame: Keyframe = {
      offset: i / (progress.length - 1),
      transform: `translate(${round(from.x + (to.x - from.x) * p)}px, ${round(from.y + (to.y - from.y) * p)}px) scale(${round(from.scale + (to.scale - from.scale) * p, 4)})`,
    };
    if (opacity !== undefined) frame.opacity = opacity;
    return frame;
  });
}

/**
 * The pose that puts a box whose resting place is `to` (read with its resting `rest` pose applied) where `from` was:
 * both rectangles are the screen's, so a scroll between the two readings is already in them.
 */
export function poseFrom(from: { left: number; top: number; width: number }, to: { left: number; top: number }, rest: Pose, width: number): Pose {
  // The box's own corner, without the resting pose: where a transform of nothing would draw it.
  const left = to.left - rest.x;
  const top = to.top - rest.y;
  return { x: from.left - left, y: from.top - top, scale: width > 0 ? from.width / width : 1 };
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * The hand-off between layouts. Wallet's grid and carousel are other ways of laying the same cards out, and an opened
 * card is always the stack's raised card — so a card tapped in the grid is one element that goes away and another
 * that appears. To make it read as one card flying, the element leaving says where it was, and the one arriving
 * starts there. A hand-off is kept only for a moment: one nobody takes in time belonged to a journey that went
 * elsewhere.
 */
const HANDOFF_MS = 600;
let handoff: { key: string; rect: { left: number; top: number; width: number; height: number }; at: number } | null = null;

/** Says where card `key` was on screen as it leaves one layout for another. */
export function leaveFrom(key: string, rect: DOMRect | { left: number; top: number; width: number; height: number }): void {
  handoff = { key, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, at: performance.now() };
}

/** Takes the place a card left from, if it was just now — and, given `keys`, only for a card among them. */
export function arriveFrom(keys?: readonly string[]): { key: string; rect: { left: number; top: number; width: number; height: number } } | null {
  const taken = handoff;
  handoff = null;
  if (!taken || performance.now() - taken.at > HANDOFF_MS) return null;
  if (keys && !keys.includes(taken.key)) return null;
  return { key: taken.key, rect: taken.rect };
}

/**
 * Flies `node` from `from` (a screen rectangle) into its resting place, on the spring. The node's own box is read
 * once, here; nothing is read again while it moves. Returns the animation, or null where there is nothing to do.
 */
export function flyInto(node: HTMLElement, from: { left: number; top: number; width: number }, options: { delay?: number; rest?: Pose; width?: number; opacity?: number } = {}): Animation | null {
  if (typeof node.animate !== 'function') return null;
  const rest = options.rest ?? { x: 0, y: 0, scale: 1 };
  const to = node.getBoundingClientRect();
  const width = options.width ?? node.offsetWidth;
  const start = poseFrom(from, to, rest, width);
  if (Math.abs(start.x - rest.x) < 0.5 && Math.abs(start.y - rest.y) < 0.5 && Math.abs(start.scale - rest.scale) < 0.002) return null;
  // The poses are measured from the box's top-left corner, so that is the point it scales from.
  node.style.transformOrigin = '0 0';
  return node.animate(flightKeyframes(start, rest, springProgress(), options.opacity), { duration: MOVE_MS, delay: options.delay ?? 0, easing: 'linear', fill: 'backwards' });
}
