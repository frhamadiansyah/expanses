import { formatMinor } from '@expanses/core';
import { PHONE_WIDTH, textWidth } from './metrics';
import { type Direction, moneyTone, type Tone } from './row';

/**
 * The figure that is the point of the page, and the bar under it.
 *
 * Both are arithmetic over integer minor units. Nothing here divides money: a progress bar is a ratio, worked
 * out once, and the money either side of it stays whole.
 */

export interface HeroFigure {
  text: string;
  tone: Tone;
}

/** The figure, formatted and coloured. `formatMinor` gives IDR no decimals and a no-break space after `Rp`. */
export function heroFigure(minor: number, currency: string, direction: Direction = 'neutral'): HeroFigure {
  return { text: formatMinor(minor, currency), tone: moneyTone(minor, direction) };
}

/** Money is never drawn smaller than this, however long the figure: past it the figure stops being the point of the page. */
export const FIGURE_FLOOR = 26;

/** The sizes a hero figure steps down through: the kit's own figure first, and the floor last. */
export const FIGURE_STEPS = [40, 34, 30, FIGURE_FLOOR] as const;

/**
 * How wide a figure may be drawn: a 390 pt phone's column, less the screen's own gutters and a panel's padding, with
 * a fifth of what is left kept in hand.
 *
 * `textWidth` matches what a browser draws to within a few px, and a phone running iOS draws its own font a shade
 * wider than that — and a letter either side of the line is the difference between a figure that fits and a page
 * that scrolls sideways.
 */
export const FIGURE_WIDTH = Math.round((PHONE_WIDTH - 4 * 16) * 0.85);

/**
 * The size a hero figure is drawn at.
 *
 * A figure is the point of the page, so it is drawn as large as it can be while staying inside the column. It was
 * drawn at 40 px whatever it said, and "Rp 171.274.729" at 40 is wider than a phone's panel: the figure ran off the
 * right of the screen and took the rest of the page with it, because a page that overflows is a page as wide as its
 * widest child — the section row, the chart and the list all scrolled together.
 */
export function figureSize(text: string): number {
  return FIGURE_STEPS.find((size) => textWidth(text, size) <= FIGURE_WIDTH) ?? FIGURE_FLOOR;
}

/**
 * How full the bar is, 0 to 1.
 *
 * Clamped at both ends: a goal passed is a full bar rather than a bar running off its track, and money owed
 * against nothing budgeted is an empty bar rather than a division by zero. Money stays integer — only the
 * ratio is a fraction, and it is never turned back into money.
 */
export function progressFraction(currentMinor: number, targetMinor: number): number {
  if (targetMinor <= 0) return 0;
  if (currentMinor <= 0) return 0;
  return Math.min(1, currentMinor / targetMinor);
}

/** The same ratio as a whole percent, for the label beside the bar and for `aria-valuenow`. */
export function progressPercent(currentMinor: number, targetMinor: number): number {
  return Math.round(progressFraction(currentMinor, targetMinor) * 100);
}

/**
 * The bar's colour: the tint while there is room, alarm once the target is passed.
 *
 * A bar that fills to the end and stops is a bar that cannot say whether it stopped at the line or went
 * through it, which on a budget is the only thing worth knowing.
 */
export function progressTone(currentMinor: number, targetMinor: number): Tone {
  if (targetMinor <= 0) return 'ink-3';
  return currentMinor > targetMinor ? 'alarm' : 'tint';
}
