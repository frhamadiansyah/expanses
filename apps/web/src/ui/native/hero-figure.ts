import { formatMinor } from '@expanses/core';
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
