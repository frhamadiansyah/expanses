import type { LinkProps } from '@tanstack/react-router';
import { PHONE_WIDTH, textWidth } from './metrics';

/**
 * How many segments fit, and what they are called when they only just do.
 *
 * A segmented control replaces every underline tab row in the app, and the thing an underline tab row does that
 * a segmented control must never do is wrap. Wrapping is what `/net-worth` does today with five tabs at 390 px,
 * and it is the defect this module exists to make impossible: the answer is always a single line, so something
 * has to give, and this decides what.
 */

/** Four is the most a 390 pt phone holds without the labels becoming initials. */
export const PHONE_MAX = 4;

/**
 * What the control draws, which is not what a thumb hits.
 *
 * These are iOS's own figures — a segment 28 tall inside a 32 tall track, and a `…` 32 square beside it — and
 * they stay that way. `tapReach` from `metrics` is what lifts each of them to the 44 pt floor, without any of
 * them growing: the target is a box around the segment, not the segment.
 */
export const SEGMENT_HEIGHT = 28;
export const SEGMENT_MORE = 32;

/** The track's own padding, and the breathing room a label needs inside its segment. */
const TRACK_PAD = 2;
const SEGMENT_PAD = 9;

/**
 * The route a segment names, when it names one.
 *
 * A segment that changes the address is a link, and a link is the only thing a middle click, a ⌘-click or an
 * "open in a new tab" knows what to do with. A radio button that calls `navigate` looks and sounds identical
 * and answers none of the three — which on the app's main section navigation is desktop reach quietly removed.
 * `InsetRow` and `CornerButton` took a route for this reason in 16a3c47; this is the same fix in the same shape.
 */
export interface SegmentRoute {
  to: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
}

export interface Segment extends Partial<SegmentRoute> {
  key: string;
  label: string;
  /**
   * A shorter name for the same thing, used only when the full one will not fit — "Rewards rules" becomes
   * "Rules" so four segments survive at phone width.
   */
  short?: string;
}

export interface PlacedSegment {
  key: string;
  /** The name actually drawn: `label`, or `short` when the full one would have been clipped. */
  label: string;
  shortened: boolean;
  /** The route this segment goes to, or `null` when it only changes something on the page. */
  route: SegmentRoute | null;
}

/**
 * Whether a segment navigates, and where to.
 *
 * A segment names a route or it does not; the answer is never guessed from a key that happens to look like a
 * path. `null` is the honest reply for a filter, a period or a form's two directions, none of which have an
 * address to open in a second tab.
 */
export function segmentRoute(segment: Segment): SegmentRoute | null {
  if (segment.to === undefined) return null;
  return { to: segment.to, params: segment.params, search: segment.search };
}

export interface SegmentPlan {
  shown: PlacedSegment[];
  /** Everything that did not fit. A caller puts these behind a `…`, or moves them into the page. */
  overflow: Segment[];
  /** Each segment's share of the track, in px — they are equal, always. */
  segmentWidth: number;
}

/**
 * Fit `items` into a track `width` px wide.
 *
 * Segments are equal width because that is what makes the control read as one object rather than as tabs, so
 * the widest label sets what every segment must hold. The search is: try them all, shorten what has a short
 * name, and only then start moving the last ones out — a tab is better renamed than hidden, and better hidden
 * than wrapped.
 */
export function fitSegments(items: readonly Segment[], width = PHONE_WIDTH, max = PHONE_MAX): SegmentPlan {
  if (items.length === 0) return { shown: [], overflow: [], segmentWidth: 0 };

  for (let count = Math.min(items.length, max); count >= 1; count -= 1) {
    const taken = items.slice(0, count);
    const segmentWidth = Math.floor((width - TRACK_PAD * 2) / count);
    const room = segmentWidth - SEGMENT_PAD * 2;
    const placed = taken.map((item): PlacedSegment => {
      // The route travels with the segment whatever its label does: a shortened name is still the same address.
      const route = segmentRoute(item);
      if (textWidth(item.label, 12.5) <= room) return { key: item.key, label: item.label, shortened: false, route };
      if (item.short && textWidth(item.short, 12.5) <= room) return { key: item.key, label: item.short, shortened: true, route };
      return { key: item.key, label: item.short ?? item.label, shortened: Boolean(item.short), route };
    });
    const fits = placed.every((segment) => textWidth(segment.label, 12.5) <= room);
    // The last pass keeps whatever it produced: one segment that still will not fit is a label nobody can
    // shorten, and showing it clipped beats showing an empty track.
    if (fits || count === 1) return { shown: placed, overflow: items.slice(count), segmentWidth };
  }

  /* c8 ignore next — the loop above always returns at count === 1. */
  return { shown: [], overflow: [...items], segmentWidth: 0 };
}

/**
 * Which segment a path selects: the **longest** key that is the path, or a parent of it.
 *
 * `find` is the obvious loop and it is wrong for a sectioned app. `/net-worth` is a prefix of
 * `/net-worth/debts`, so the first match lights **Overview** on every net-worth section: the tab navigates, the
 * address is right, and the control says the reader never left the overview. The longest match is the section
 * actually being read, and it needs no special case for the section root — which is why it is the rule.
 *
 * A key is a parent only on a whole segment (`/net-worth/`), never on a shared prefix: `/net-worthish` is not
 * under `/net-worth`, and must not light it.
 */
export function activeSegment(keys: readonly string[], pathname: string, fallback: string): string {
  let best: string | null = null;
  for (const key of keys) {
    if (pathname !== key && !pathname.startsWith(`${key}/`)) continue;
    if (best === null || key.length > best.length) best = key;
  }
  return best ?? fallback;
}

