/**
 * What fits on the back of a card: the card is a fixed box (the Wallet card's), and the balance has to be drawn
 * inside it. The label, the figure and the account line always are; the foreign-money line and the 30-day line are
 * given the room that is left, and a line that would be squeezed under a readable height is dropped rather than drawn
 * cramped, so the back never overflows the card it is the back of.
 */

/** Padding on every side of the back, then the fixed rows inside it. */
const PAD = 14;
const LABEL = 15;
const FIGURE = 32;
const CAPTION = 18;
/** The dashed rule's gap and the ends' words ("30 days ago", "today") under the line. */
const RULE = 12;
const ENDS = 16;
/** The line is never drawn shorter than this, nor taller than the page's own balance card draws it. */
export const MIN_SPARK = 28;
export const MAX_SPARK = 64;
/** The line's drawing keeps a strip under it for a crossing's date. */
const SPARK_PAPER = 16;

export interface BackLayout {
  /** Whether the foreign-money line ("≈ Rp … at …") is kept under the account line. */
  foreign: boolean;
  /** The height of the 30-day line's plot, or null when there is no room to draw it. */
  spark: number | null;
}

/**
 * @param cardHeight the card's height in pixels
 * @param captionLines how many lines the account facts take: the account line, and the foreign-money line if any
 */
export function backLayout(cardHeight: number, captionLines: number): BackLayout {
  const fixed = (lines: number) => PAD * 2 + LABEL + FIGURE + CAPTION * lines;
  const room = (lines: number) => cardHeight - fixed(lines) - RULE - ENDS - SPARK_PAPER - 6;
  // The account line is kept before anything; the foreign line goes before the drawing does.
  const lines = Math.max(1, captionLines);
  const withForeign = room(lines);
  if (withForeign >= MIN_SPARK) return { foreign: lines > 1, spark: Math.min(MAX_SPARK, Math.floor(withForeign)) };
  const without = room(1);
  if (without >= MIN_SPARK) return { foreign: false, spark: Math.min(MAX_SPARK, Math.floor(without)) };
  return { foreign: false, spark: null };
}

/** The back's corner: the card's own, scaled with its width as the face's is (the face is drawn at 240). */
export function backRadius(cardWidth: number): number {
  return Math.round((14.4 * cardWidth) / 240);
}
