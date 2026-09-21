import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, cardFigure, cardHeightFor, cardsBeforeScrolling, faceIsBehind, FAN_X, stackLayout, STRIP } from './card-stack';

const WALLET = ['bca-krisflyer', 'mandiri-skyz', 'bni-bonvoy'];

describe('stackLayout', () => {
  it('lays out an empty wallet as a box of nothing', () => {
    expect(stackLayout([])).toEqual({ cards: [], front: -1, width: 0, height: 0, cardWidth: CARD_W, cardHeight: CARD_H });
  });

  it('puts the front card at the top, whole, with the others peeking out below it a strip apart', () => {
    const { cards, front } = stackLayout(WALLET);
    expect(front).toBe(0);
    expect(cards.map((card) => card.top)).toEqual([0, STRIP, STRIP * 2]);
    // The front card is on top of the pile, and each card below it is under the one above.
    expect(cards.map((card) => card.zIndex)).toEqual([2, 1, 0]);
  });

  it('leaves each covered card its bottom strip and the front card its whole face, so every figure reads without a tap', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => card.visible)).toEqual([CARD_H, STRIP, STRIP]);
    // What shows of a covered card is its foot: the band below the card in front of it.
    expect(cards.map((card) => card.clip)).toEqual([0, CARD_H - STRIP, CARD_H - STRIP]);
    // So the band a covered card shows starts exactly where the card in front of it ends.
    expect(cards[1]!.top + cards[1]!.clip).toBe(cards[0]!.top + CARD_H);
    expect(cards[2]!.top + cards[2]!.clip).toBe(cards[1]!.top + CARD_H);
  });

  it('needs exactly the room the overlap asks for', () => {
    expect(stackLayout(WALLET).height).toBe(STRIP * 2 + CARD_H);
    expect(stackLayout(WALLET).width).toBe(CARD_W);
  });

  it('brings a lifted card to the front, at the top, and keeps the rest in their order below it', () => {
    const { cards, front } = stackLayout(WALLET, { lifted: 2 });
    expect(front).toBe(2);
    expect(cards[2]!.top).toBe(0);
    expect(cards[2]!.visible).toBe(CARD_H);
    expect(cards[2]!.zIndex).toBe(2);
    expect(cards[0]!.top).toBe(STRIP);
    expect(cards[1]!.top).toBe(STRIP * 2);
    expect(cards.map((card) => card.lifted)).toEqual([false, false, true]);
  });

  it('is the same height whichever card is in front', () => {
    expect(stackLayout(WALLET, { lifted: 1 }).height).toBe(stackLayout(WALLET).height);
  });

  it('draws a phone’s cards as wide as its column, on a card’s own shape', () => {
    const layout = stackLayout(WALLET, { cardWidth: 358 });
    expect(layout.cardWidth).toBe(358);
    expect(layout.cardHeight).toBe(cardHeightFor(358));
    expect(cardHeightFor(358)).toBe(226);
    expect(layout.width).toBe(358);
    expect(layout.height).toBe(STRIP * 2 + 226);
    expect(layout.cards[1]!.clip).toBe(226 - STRIP);
  });

  it('fans sideways on a wide screen instead of overlapping downwards, at the desktop’s own width', () => {
    const { cards, width, height, front } = stackLayout(WALLET, { fan: true, cardWidth: 358 });
    expect(cards.map((card) => card.top)).toEqual([0, 0, 0]);
    expect(cards.map((card) => card.left)).toEqual([0, FAN_X, FAN_X * 2]);
    expect(front).toBe(2);
    expect(width).toBe(FAN_X * 2 + CARD_W);
    expect(height).toBe(CARD_H);
  });
});

/**
 * Which faces print their own rows. This is the whole of the `behind` wiring: a card the stack clips to a band
 * must not print its bank mark, wordmark or digits, because they land in the same pixels as the strip's name and
 * figure — two texts on one band, which is what the wall drew before this was pinned.
 */
describe('faceIsBehind', () => {
  it('leaves every covered card to its strip and prints the front card whole', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => faceIsBehind(card))).toEqual([false, true, true]);
  });

  it('prints the lifted card whole, now it is in front, and the one it replaced goes behind', () => {
    const { cards } = stackLayout(WALLET, { lifted: 1 });
    expect(cards.map((card) => faceIsBehind(card))).toEqual([true, false, true]);
  });

  it('counts a fanned card as covered whenever only its leading edge shows', () => {
    const { cards } = stackLayout(WALLET, { fan: true });
    expect(cards.map((card) => faceIsBehind(card))).toEqual([true, true, false]);
  });
});

describe('cardsBeforeScrolling', () => {
  it('shows six or seven cards in the room a phone screen leaves the stack, which is what C3 was chosen on', () => {
    expect(cardsBeforeScrolling(460)).toBe(6);
    expect(cardsBeforeScrolling(500)).toBe(7);
  });

  it('shows none at all when there is not even room for one card', () => {
    expect(cardsBeforeScrolling(0)).toBe(0);
    expect(cardsBeforeScrolling(CARD_H - 1)).toBe(0);
    expect(cardsBeforeScrolling(CARD_H)).toBe(1);
  });
});

describe('cardFigure', () => {
  it('counts points rather than formatting them as money', () => {
    expect(cardFigure(42_500, null, 'miles')).toBe('42.500 miles');
  });

  it('formats what is owed as money, with no decimals for IDR', () => {
    expect(cardFigure(8_412_000, 'IDR')).toBe('Rp 8.412.000');
  });

  it('gives a currency its own decimals rather than assuming IDR’s nought', () => {
    expect(cardFigure(129_900, 'USD')).toBe('US$1.299,00');
  });
});
