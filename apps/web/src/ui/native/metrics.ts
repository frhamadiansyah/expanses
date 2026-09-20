/**
 * The measurements the kit is built from, and the one piece of arithmetic every primitive needs: how wide a
 * string will be.
 *
 * These are the real iOS figures at a 390 pt phone, not Tailwind's scale. They live in one module because two
 * primitives disagreeing about what 44 pt is would be the same defect the restyle exists to remove.
 */

/** The smallest thing a finger may be asked to hit. Every tappable row, button and segment clears it. */
export const TAP = 44;

/** A phone's width in CSS pixels, and the width every phone-side decision is taken at unless told otherwise. */
export const PHONE_WIDTH = 390;

/** Row padding: 11 px down, 13 px in. The 13 is also where a separator starts on a row with no icon. */
export const ROW_PAD_Y = 11;
export const ROW_PAD_X = 13;

/** A row's tinted circular icon, and the gap between it and the text. */
export const ROW_ICON = 28;
export const ROW_ICON_GAP = 10;

/** The chevron's glyph box, and the gap before it. */
export const CHEVRON = 7;
export const CHEVRON_GAP = 6;

/** The gap between the text block and a trailing value. */
export const VALUE_GAP = 10;

/** Below this a title is a column of broken words rather than a title, so the kit calls the row overflowing. */
export const MIN_TEXT = 96;

/** A group's corner radius, and the air under it before the next group's header. */
export const GROUP_RADIUS = 11;
export const GROUP_GAP = 18;

/**
 * Per-character advance as a fraction of the font size.
 *
 * Measuring text properly needs a canvas, and `apps/web` has no DOM to measure in — so the kit estimates, and
 * every decision that uses the estimate is one where being a few pixels pessimistic costs nothing (a label
 * shortens, a row reports itself tight) and being wrong in the other direction would wrap something that must
 * never wrap. The table is deliberately generous for that reason.
 */
const NARROW = new Set([...'iljtfIr.,;:\'"!|()[]{} ']);
const WIDE = new Set([...'mwMW@%']);

/**
 * How wide `text` will be at `size` px, in px.
 *
 * Digits are asked about **first**, and every digit is the same width: the kit sets money in tabular figures,
 * where a 1 takes exactly the room a 9 takes. Measuring a 1 as a narrow letter would make `Rp 1.111.111` and
 * `Rp 9.876.543` different widths, and a column of figures that changes width as the month goes on.
 */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const char of text) {
    if (char >= '0' && char <= '9') em += 0.6;
    else if (NARROW.has(char)) em += 0.32;
    else if (WIDE.has(char)) em += 0.92;
    else if (char >= 'A' && char <= 'Z') em += 0.68;
    else em += 0.56;
  }
  return Math.ceil(em * size);
}

/**
 * How tall a row is: its padding plus whatever it holds, but never less than a tap target.
 *
 * A title alone comes to 15 px of text in a 20 px line box, which with 11 px of padding twice is 42 — under
 * the floor, so the floor wins and the row is padded out to 44. A subtitle pushes it past on its own.
 */
export function rowHeight(hasSubtitle: boolean): number {
  const text = hasSubtitle ? 20 + 2 + 16 : 20;
  return Math.max(TAP, ROW_PAD_Y * 2 + text);
}
