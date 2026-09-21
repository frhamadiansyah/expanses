import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, cardFigure, cardsBeforeScrolling, faceIsBehind, FAN_X, stackLayout, STRIP } from './card-stack';

const WALLET = ['bca-krisflyer', 'mandiri-skyz', 'bni-bonvoy'];

describe('stackLayout', () => {
  it('lays out an empty wallet as a box of nothing', () => {
    expect(stackLayout([])).toEqual({ cards: [], width: 0, height: 0 });
  });

  it('overlaps the cards a strip apart, front card last so it sits on top', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => card.top)).toEqual([0, STRIP, STRIP * 2]);
    expect(cards.map((card) => card.zIndex)).toEqual([0, 1, 2]);
  });

  it('leaves each covered card its strip and the last card its whole face, so every figure reads without a tap', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => card.visible)).toEqual([STRIP, STRIP, CARD_H]);
  });

  it('needs exactly the room the overlap asks for', () => {
    expect(stackLayout(WALLET).height).toBe(STRIP * 2 + CARD_H);
    expect(stackLayout(WALLET).width).toBe(CARD_W);
  });

  it('lifts a card by moving what is below it down, and nothing above it at all', () => {
    const { cards } = stackLayout(WALLET, { lifted: 0 });
    expect(cards[0]!.top).toBe(0);
    expect(cards[0]!.visible).toBe(CARD_H);
    expect(cards[1]!.top).toBe(STRIP + (CARD_H - STRIP));
    expect(cards[2]!.top).toBe(STRIP * 2 + (CARD_H - STRIP));
  });

  it('grows the box by the space the lift opened', () => {
    expect(stackLayout(WALLET, { lifted: 0 }).height).toBe(STRIP * 2 + CARD_H + (CARD_H - STRIP));
  });

  it('asks for no extra room when the card lifted is already the front one', () => {
    expect(stackLayout(WALLET, { lifted: 2 }).height).toBe(stackLayout(WALLET).height);
  });

  it('fans sideways on a wide screen instead of overlapping downwards', () => {
    const { cards, width, height } = stackLayout(WALLET, { fan: true });
    expect(cards.map((card) => card.top)).toEqual([0, 0, 0]);
    expect(cards.map((card) => card.left)).toEqual([0, FAN_X, FAN_X * 2]);
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
    expect(cards.map((card) => faceIsBehind(card, false))).toEqual([true, true, false]);
  });

  it('opens the lifted card whole and leaves the band below it as it was', () => {
    const { cards } = stackLayout(WALLET, { lifted: 0 });
    // The front card is whole whether or not anything is lifted; the lift opens the card itself and slides the
    // rest down, so the band under it is still a band.
    expect(cards.map((card) => faceIsBehind(card, false))).toEqual([false, true, false]);
  });

  it('counts a fanned card as covered whenever only its leading edge shows', () => {
    const { cards } = stackLayout(WALLET, { fan: true });
    expect(cards.map((card) => faceIsBehind(card, true))).toEqual([true, true, false]);
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
