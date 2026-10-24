import { formatMinor } from '@expanses/core';

/**
 * Where each card sits in the Wallet stack.
 *
 * The seventh primitive, added deliberately when `/cards` was settled on the C3 wallet stack: cards overlap,
 * every card is visible at once, and tapping one opens it.
 *
 * It is drawn the way Apple Wallet draws a pile of cards, **back to front**: the rearmost card sits at the top,
 * each card after it sits a band lower and is laid over the one before, and the front card comes last, at the
 * bottom, whole. Every card is its own whole face at one width, so what shows of a covered card is its **top
 * band** — the edge a bank prints its mark on. Wallet uses that band for identity; this uses it for identity
 * *and* the card's figure, so "how many miles have I got?" is answered without a tap.
 *
 * Opening a card is Wallet's selected state: that card rises to the top of the stack's place, whole and at the
 * same width, and the others slide down together into a tight pile at the foot of the screen, their top edges
 * peeking, as Wallet's do (owner, 2026-10-24); a tap on the pile puts the open card back. Closing it
 * puts every card back in its slot. Both states are laid out here, so the component only moves one element between
 * them.
 *
 * A phone and a desktop use the same stack; a desktop simply draws its cards at Wallet's fixed width on a Mac
 * rather than the phone's whole column.
 */

/** A `CardFace` at `size="md"` is 240 px wide on a 1.586 aspect: the art every card is drawn at, then scaled. */
export const CARD_W = 240;
export const CARD_H = Math.round(CARD_W / 1.586);

/** The top band of a covered card the next card leaves showing — its bank mark and its figure, as in Wallet. */
export const STRIP = 60;

/** A desktop's card: Wallet's own size on a Mac, rather than a card stretched across a 1440 px column. */
export const DESKTOP_CARD_W = 380;

/**
 * The pile the other cards drop into while one is open, as Wallet's does: a few top edges stepped down, each card
 * behind a little narrower than the one in front, the rest tucked behind the last edge.
 */
export const PILE_EDGES = 4;
export const PILE_STEP = 8;
export const PILE_SHRINK = 0.04;
/**
 * How much of the pile's front card shows at the foot of the screen while a card is open, as in Wallet: a strip of
 * plain colour, above the band's print, with the edges of the cards behind it stepped up over it. The owner chose
 * Wallet's peeking pile (2026-10-24), replacing the earlier "nothing else showing" (2026-09-22).
 */
export const PILE_PEEK = 16;
/**
 * What the pile stands on, above the bottom of the screen and its home indicator: the phone's tab bar — its 48 px
 * tabs in a 6 px padded, 1 px bordered capsule over a 12 px margin (`TabBar`) — and a small gap; a desktop's margin.
 */
export const PILE_FLOOR_PHONE = 74 + 6;
export const PILE_FLOOR_DESKTOP = 16;

/** How tall the peeking pile of `count` cards is: the front card's strip and the stepped edges above it. */
export function pileHeight(count: number): number {
  if (count <= 0) return 0;
  return PILE_PEEK + (Math.min(count, PILE_EDGES) - 1) * PILE_STEP;
}

export interface StackedCard {
  key: string;
  /**
   * Where the card is: in its `slot` in the stack at rest, `raised` to the top while it is open, or `hidden` in the
   * pile at the foot of the screen while another card is — its edge showing, out of reach of the keyboard and of a
   * reader, and a tap on the pile closes the open card rather than opening this one.
   */
  place: 'slot' | 'raised' | 'hidden';
  /** Offset of the card's face from the stack's top, in px, for a card in its slot or raised. */
  top: number;
  zIndex: number;
  /** How much of this card shows uncovered: its whole face in front or raised, its band when covered, none hidden. */
  visible: number;
  /** Whether another card is laid over all but this card's top band. */
  covered: boolean;
  /**
   * A hidden card's place in the pile below the screen: how far its top sits below the pile's top line, and how much
   * narrower it is drawn, from its top centre. Absent for a card in its slot or raised.
   */
  pile?: { top: number; scale: number };
}

export interface StackLayout {
  cards: StackedCard[];
  /** Index (into the keys given) of the card drawn whole: the last one at rest, the raised one while one is open. */
  front: number;
  /** Index of the raised card, or null at rest. */
  raised: number | null;
  /**
   * The box the stack takes in the page. At rest it is the whole stack; while a card is raised it is nothing, since
   * the raised card sits over the slot its page leaves for it and the rest are hidden.
   */
  width: number;
  height: number;
  /** The width and height every card is drawn at: one width for all of them, as in a real pile. */
  cardWidth: number;
  cardHeight: number;
}

export interface StackOptions {
  /** Index of the card that is open, or null when the stack is at rest. */
  raised?: number | null;
  /**
   * How wide every card is drawn — a phone's column inside its gutter, or a desktop's fixed card. The aspect is a
   * card's own, 1.586.
   */
  cardWidth?: number;
}

/** A card's height at a given width: the ISO/IEC 7810 ID-1 shape every bank card is printed on. */
export function cardHeightFor(width: number): number {
  return Math.round(width / 1.586);
}

/**
 * Lay out `keys` as a stack, back to front.
 *
 * At rest the first key is the rearmost card, at the top, and each key after it sits a band lower, laid over the
 * one before; the last key is the front card, at the bottom, whole. While a card is raised it sits at the top,
 * whole and above everything, and the rest are hidden; each keeps its slot, so closing puts it back exactly there.
 */
export function stackLayout(keys: readonly string[], options: StackOptions = {}): StackLayout {
  const last = keys.length - 1;
  const width = options.cardWidth ?? CARD_W;
  const height = cardHeightFor(width);
  const raised = options.raised !== undefined && options.raised !== null && options.raised >= 0 && options.raised <= last ? options.raised : null;

  const cards: StackedCard[] = keys.map((key, index) => {
    if (raised === null) return { key, place: 'slot', top: index * STRIP, zIndex: index, visible: index === last ? height : STRIP, covered: index !== last };
    if (index === raised) return { key, place: 'raised', top: 0, zIndex: keys.length, visible: height, covered: false };
    return { key, place: 'hidden', top: index * STRIP, zIndex: index, visible: 0, covered: true, pile: pilePlace(index < raised ? index : index - 1, last) };
  });
  return {
    cards,
    front: keys.length === 0 ? -1 : (raised ?? last),
    raised,
    width: keys.length === 0 ? 0 : width,
    height: keys.length === 0 || raised !== null ? 0 : height + last * STRIP,
    cardWidth: width,
    cardHeight: height,
  };
}

/**
 * Where the `at`-th of `count` cards in the pile sits (back to front, as in the stack): the front card lowest and
 * whole width, each card behind it one step higher and a shade narrower, and every card past the last edge tucked
 * behind it.
 */
export function pilePlace(at: number, count: number): { top: number; scale: number } {
  const edges = Math.min(count, PILE_EDGES);
  const depth = Math.min(count - 1 - at, edges - 1);
  return { top: (edges - 1 - depth) * PILE_STEP, scale: Math.round((1 - depth * PILE_SHRINK) * 1000) / 1000 };
}

/**
 * Whether a card is drawn as its top band — the bank's mark and the card's figure, and none of the rows further
 * down the face, which the card laid over it hides anyway.
 *
 * Recorded as a function rather than as a comparison inside the component so the band and the face read the same
 * answer.
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
 * The figure on a card's band.
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
