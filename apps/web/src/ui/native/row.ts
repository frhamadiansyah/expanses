import { CHEVRON, CHEVRON_GAP, MIN_TEXT, PHONE_WIDTH, ROW_ICON, ROW_ICON_GAP, ROW_PAD_X, textWidth, VALUE_GAP } from './metrics';

/**
 * What a row decides before it is drawn: what colour its trailing figure is, how much width its words have
 * left, and where its separator starts.
 *
 * All of it is arithmetic, so all of it is tested here rather than inspected in a browser.
 */

export type Tone = 'ink' | 'ink-2' | 'ink-3' | 'alarm' | 'warn' | 'tint';

/** Which way money moved, said plainly, because a sign alone does not say it in every ledger. */
export type Direction = 'out' | 'in' | 'neutral';

/**
 * The colour a figure is drawn in.
 *
 * Money that left is `alarm` whatever its sign — an expense of Rp 899.000 is stored positive on a row that
 * knows it is an expense, and it must read the same as a negative balance does. A neutral figure — a balance,
 * a total, a count — is only alarming when it is itself below zero.
 */
export function moneyTone(minor: number, direction: Direction = 'neutral'): Tone {
  if (direction === 'out') return 'alarm';
  if (direction === 'in') return 'tint';
  return minor < 0 ? 'alarm' : 'ink';
}

export interface RowShape {
  /** A tinted circular icon at the leading edge. */
  icon?: boolean;
  title: string;
  subtitle?: string | null;
  /** The trailing figure, already formatted. It is the fact the row exists for, so it is never truncated. */
  value?: string | null;
  chevron?: boolean;
}

export interface RowLayout {
  /** Pixels left for the title and subtitle once the icon, value and chevron have taken theirs. */
  textWidth: number;
  /** Width reserved for the trailing figure — its natural width, since it may not shrink. */
  valueWidth: number;
  /** Where the separator starts: level with the text, never at the row's own edge. It ends at the same padding. */
  separatorInset: number;
  /** The title will be clipped at this width. A caller that can shorten its subtitle should. */
  overflowing: boolean;
}

/**
 * How a row's width is spent.
 *
 * The order of claims is the order of importance, and it is not negotiable: the icon and the chevron are fixed
 * furniture, the trailing figure takes exactly what it needs, and the words live on what is left. That is why a
 * long merchant name ellipsises and a Rp figure never does — the alternative, a figure squeezed to "Rp 12.4…",
 * is a row that has stopped answering the question it was put there to answer.
 */
export function planRow(row: RowShape, width = PHONE_WIDTH): RowLayout {
  const valueWidth = row.value ? textWidth(row.value, 15) : 0;
  const furniture =
    ROW_PAD_X * 2 +
    (row.icon ? ROW_ICON + ROW_ICON_GAP : 0) +
    (row.chevron ? CHEVRON + CHEVRON_GAP : 0) +
    (row.value ? valueWidth + VALUE_GAP : 0);
  const textWidthLeft = Math.max(0, width - furniture);
  const longest = Math.max(textWidth(row.title, 15), row.subtitle ? textWidth(row.subtitle, 12.5) : 0);
  return {
    textWidth: textWidthLeft,
    valueWidth,
    separatorInset: ROW_PAD_X + (row.icon ? ROW_ICON + ROW_ICON_GAP : 0),
    overflowing: textWidthLeft < MIN_TEXT || longest > textWidthLeft,
  };
}

/**
 * A tinted circular icon is a 12 % wash of its category's colour, and the glyph is that colour at full strength.
 *
 * Taken from the colour rather than from a second palette, so a category keeps one identity across the donut,
 * the row and the hero.
 */
export function iconTint(colour: string): { background: string; foreground: string } {
  return { background: `color-mix(in srgb, ${colour} 12%, transparent)`, foreground: colour };
}
