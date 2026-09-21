import { formatMinor } from '@expanses/core';

/**
 * Where each card sits in the Wallet stack.
 *
 * The seventh primitive, added deliberately when `/cards` was settled on the C3 wallet stack: cards overlap,
 * every card is visible at once, and tapping one brings it to the front.
 *
 * C3's known weakness is that only the front card's figures show. The answer built in here is the **strip** —
 * the band of each card the one above it does not cover. Apple Wallet uses that band for identity; this uses it
 * for identity *and* the card's figure, so "how many miles have I got?" is answered without a tap.
 *
 * On a wide screen the stack fans sideways instead of overlapping downwards: a phone overlaps because it has
 * height and no width, and a 1440 px window has the opposite problem. Same primitive, two geometries.
 */

/** A `CardFace` at `size="md"` is 240 px wide on a 1.586 aspect: a desktop's card, and a phone's before it is measured. */
export const CARD_W = 240;
export const CARD_H = Math.round(CARD_W / 1.586);

/** The band of a card its neighbour does not cover — enough for a name and a figure on one line each. */
export const STRIP = 58;

/** How far apart the cards sit when the stack fans sideways. Enough to leave each card's leading third clear. */
export const FAN_X = 96;

export interface StackedCard {
  key: string;
  /** Offset of the card's whole face from the stack's top-left, in px. */
  top: number;
  left: number;
  zIndex: number;
  /** How much of this card is showing: its strip, or the whole face when it is the front one. */
  visible: number;
  /**
   * Where, inside the card's own face, the part left showing begins. A card peeking out below the one in front
   * of it shows its **bottom** band, so this is the face's height less the strip; a whole card shows from 0.
   */
  clip: number;
  /** Whether another card covers all but this card's strip — so its face is colour alone (`faceIsBehind`). */
  covered: boolean;
  lifted: boolean;
}

export interface StackLayout {
  cards: StackedCard[];
  /** Index (into the keys given) of the card drawn whole in front — the one a tap opens and the facts describe. */
  front: number;
  /** The box the stack needs. A caller sets it so the absolutely-positioned faces are not clipped. */
  width: number;
  height: number;
  /** The width and height each face is drawn at: a phone's cards fill its column, a desktop's are 240 wide. */
  cardWidth: number;
  cardHeight: number;
}

export interface StackOptions {
  /** Index of the card the user has lifted, or null when the stack is at rest. */
  lifted?: number | null;
  /** Fan sideways rather than overlap downwards. */
  fan?: boolean;
  /**
   * How wide a card is drawn when the stack overlaps downwards — the phone's column inside its gutter, so a card
   * is as wide as the screen lets it be, as in Wallet. The aspect is a card's own, 1.586. A fan ignores it.
   */
  cardWidth?: number;
}

/** A card's height at a given width: the ISO/IEC 7810 ID-1 shape every bank card is printed on. */
export function cardHeightFor(width: number): number {
  return Math.round(width / 1.586);
}

/**
 * Lay out `keys` as a stack.
 *
 * Overlapping downwards, the **front card sits at the top**, whole, and every other card peeks out below it by
 * its strip — the bottom band of each card the one in front leaves showing, in the order given. The first key is
 * the front card at rest. Lifting a covered card brings it to the front: it moves to the top, whole, and the rest
 * keep their order beneath it, so the stack is the same height whichever card is in front.
 *
 * Fanned sideways on a wide screen, the cards run left to right with the last one whole on the right.
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
        clip: 0,
        covered: index !== last,
        lifted: index === lifted,
      })),
      front: last,
      width: keys.length === 0 ? 0 : last * FAN_X + CARD_W,
      height: keys.length === 0 ? 0 : CARD_H,
      cardWidth: CARD_W,
      cardHeight: CARD_H,
    };
  }

  const width = options.cardWidth ?? CARD_W;
  const height = cardHeightFor(width);
  const front = keys.length === 0 ? -1 : lifted !== null && lifted >= 0 && lifted <= last ? lifted : 0;
  // How deep each card sits: the front card at 0, then the others in the order they were given.
  const order = front < 0 ? [] : [front, ...keys.map((_, index) => index).filter((index) => index !== front)];
  const depth = new Map(order.map((index, at) => [index, at]));
  const cards = keys.map((key, index) => {
    const d = depth.get(index)!;
    return {
      key,
      top: d * STRIP,
      left: 0,
      zIndex: last - d,
      visible: d === 0 ? height : STRIP,
      clip: d === 0 ? 0 : height - STRIP,
      covered: d !== 0,
      lifted: index === lifted,
    };
  });
  return {
    cards,
    front,
    width: keys.length === 0 ? 0 : width,
    height: keys.length === 0 ? 0 : last * STRIP + height,
    cardWidth: width,
    cardHeight: height,
  };
}

/**
 * Whether a card's face is drawn *behind* the cards in front of it, so only its colour shows.
 *
 * A card showing less than its whole face is a band — its strip — and the face's own printed rows land in the
 * very pixels the strip draws its two lines in. So a covered card is handed to `CardFace` as `behind`, which
 * keeps the colour, the finish and the motif and prints none of the text. The front card prints in full, because
 * nothing is in front of it to hide it.
 *
 * Recorded as a function rather than as a comparison inside the component so the strip and the face read the
 * same answer: a band carrying the strip's two lines *and* the card's own rows is two texts in one band.
 */
export function faceIsBehind(card: StackedCard): boolean {
  return card.covered;
}

/**
 * How many cards the stack shows before the page has to scroll.
 *
 * Six or seven, at a phone's height — recorded as a function rather than as a comment so `/cards` can say so
 * out loud when a wallet outgrows the screen.
 */
export function cardsBeforeScrolling(available: number, cardHeight = CARD_H): number {
  if (available < cardHeight) return 0;
  return 1 + Math.floor((available - cardHeight) / STRIP);
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
