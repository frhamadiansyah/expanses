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

/** The track's own padding, and the breathing room a label needs inside its segment. */
const TRACK_PAD = 2;
const SEGMENT_PAD = 9;

export interface Segment {
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
      if (textWidth(item.label, 12.5) <= room) return { key: item.key, label: item.label, shortened: false };
      if (item.short && textWidth(item.short, 12.5) <= room) return { key: item.key, label: item.short, shortened: true };
      return { key: item.key, label: item.short ?? item.label, shortened: Boolean(item.short) };
    });
    const fits = placed.every((segment) => textWidth(segment.label, 12.5) <= room);
    // The last pass keeps whatever it produced: one segment that still will not fit is a label nobody can
    // shorten, and showing it clipped beats showing an empty track.
    if (fits || count === 1) return { shown: placed, overflow: items.slice(count), segmentWidth };
  }

  /* c8 ignore next — the loop above always returns at count === 1. */
  return { shown: [], overflow: [...items], segmentWidth: 0 };
}
