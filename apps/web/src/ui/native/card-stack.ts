import { formatMinor } from '@expanses/core';

/**
 * Where each card sits in the Wallet stack.
 *
 * The seventh primitive, added deliberately when `/cards` was settled on the C3 wallet stack: cards overlap,
 * every card is visible at once, and tapping one lifts it while the rest slide down.
 *
 * C3's known weakness is that only the front card's figures show. The answer built in here is the **strip** —
 * the band of each card the one above it does not cover. Apple Wallet uses that band for identity; this uses it
 * for identity *and* the card's figure, so "how many miles have I got?" is answered without a tap.
 *
 * On a wide screen the stack fans sideways instead of overlapping downwards: a phone overlaps because it has
 * height and no width, and a 1440 px window has the opposite problem. Same primitive, two geometries.
 */

/** A `CardFace` at `size="md"` is 240 px wide on a 1.586 aspect. */
export const CARD_W = 240;
export const CARD_H = Math.round(CARD_W / 1.586);

/** The band of a card its neighbour does not cover — enough for a name and a figure on one line each. */
export const STRIP = 58;

/** How far apart the cards sit when the stack fans sideways. Enough to leave each card's leading third clear. */
export const FAN_X = 96;

export interface StackedCard {
  key: string;
  /** Offset from the stack's top-left, in px. */
  top: number;
  left: number;
  zIndex: number;
  /** How much of this card is showing: its strip, or the whole face when it is the last or the lifted one. */
  visible: number;
  lifted: boolean;
}

export interface StackLayout {
  cards: StackedCard[];
  /** The box the stack needs. A caller sets it so the absolutely-positioned faces are not clipped. */
  width: number;
  height: number;
}

export interface StackOptions {
  /** Index of the card the user has lifted, or null when the stack is at rest. */
  lifted?: number | null;
  /** Fan sideways rather than overlap downwards. */
  fan?: boolean;
}

/**
 * Lay out `keys` as a stack.
 *
 * Lifting card *n* moves everything **below** it down by the rest of a card's height, and nothing above it at
 * all — so the lifted card grows into space that opens beneath it and the cards already read stay where the
 * eye left them. Moving the whole stack instead would make every tap feel like a page change.
 */
export function stackLayout(keys: readonly string[], options: StackOptions = {}): StackLayout {
  const { lifted = null, fan = false } = options;
  const last = keys.length - 1;

  if (fan) {
    return {
      cards: keys.map((key, index) => ({
        key,
        top: 0,
        left: index * FAN_X,
        zIndex: index,
        visible: index === last ? CARD_W : FAN_X,
        lifted: index === lifted,
      })),
      width: keys.length === 0 ? 0 : last * FAN_X + CARD_W,
      height: keys.length === 0 ? 0 : CARD_H,
    };
  }

  const spread = CARD_H - STRIP;
  const cards = keys.map((key, index) => ({
    key,
    top: index * STRIP + (lifted !== null && index > lifted ? spread : 0),
    left: 0,
    zIndex: index,
    visible: index === last || index === lifted ? CARD_H : STRIP,
    lifted: index === lifted,
  }));
  return {
    cards,
    width: keys.length === 0 ? 0 : CARD_W,
    height: keys.length === 0 ? 0 : last * STRIP + CARD_H + (lifted !== null && lifted < last ? spread : 0),
  };
}

/**
 * Whether a card's face is drawn *behind* the cards above it, so only its colour shows.
 *
 * A card showing less than its whole face is a band — its strip — and the face's own printed rows land in the
 * very pixels the strip draws its two lines in: the bank mark and the wordmark on the one row, the digits over
 * the figure. So a covered card is handed to `CardFace` as `behind`, which keeps the colour, the finish and the
 * motif and prints none of the text. A card the stack leaves whole — the front one, or the one the user lifted
 * — prints in full, because nothing is in front of it to hide it.
 *
 * Recorded as a function rather than as a comparison inside the component so the strip and the face read the
 * same answer: a band carrying the strip's two lines *and* the card's own rows is two texts in one band, which
 * is what the wall drew before this existed.
 */
export function faceIsBehind(card: StackedCard, fan: boolean): boolean {
  return card.visible < (fan ? CARD_W : CARD_H);
}

/**
 * How many cards the stack shows before the page has to scroll.
 *
 * Six or seven, at a phone's height — recorded as a function rather than as a comment so `/cards` can say so
 * out loud when a wallet outgrows the screen.
 */
export function cardsBeforeScrolling(available: number): number {
  if (available < CARD_H) return 0;
  return 1 + Math.floor((available - CARD_H) / STRIP);
}

/**
 * The figure on a card's strip.
 *
 * Two kinds of figure share that band. Money goes through `formatMinor`, so it carries its currency and the
 * right number of decimals — nought for IDR, three for KWD. Points are a count, not money: they have no minor
 * units to divide by and no currency to name, so they are grouped and given their own unit. Formatting points
 * as money would silently turn 42.500 miles into Rp 425,00.
 */
export function cardFigure(value: number, currency: string | null, unit = 'points'): string {
  if (currency) return formatMinor(value, currency);
  // The same locale `formatMinor` defaults to, so a points figure and a money figure group their digits alike.
  return `${new Intl.NumberFormat('id-ID').format(value)} ${unit}`;
}
