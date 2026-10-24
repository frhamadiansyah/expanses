import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, cardFigure, cardHeightFor, cardsBeforeScrolling, DESKTOP_CARD_W, faceIsBehind, PILE_EDGES, PILE_PEEK, PILE_SHRINK, PILE_STEP, pileHeight, pilePlace, stackLayout, STRIP } from './card-stack';

const WALLET = ['bca-krisflyer', 'mandiri-skyz', 'bni-bonvoy'];

describe('stackLayout', () => {
  it('lays out an empty wallet as a box of nothing', () => {
    expect(stackLayout([])).toEqual({ cards: [], front: -1, raised: null, width: 0, height: 0, cardWidth: CARD_W, cardHeight: CARD_H });
  });

  it('stacks back to front, as Wallet does: the rearmost card at the top, the front card last', () => {
    const { cards, front } = stackLayout(WALLET);
    expect(front).toBe(2);
    expect(cards.map((card) => card.top)).toEqual([0, STRIP, STRIP * 2]);
    // Each card is laid over the one before it, so the front card is above them all.
    expect(cards.map((card) => card.zIndex)).toEqual([0, 1, 2]);
  });

  it('leaves each covered card its top band and the front card its whole face, so every figure reads without a tap', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => card.visible)).toEqual([STRIP, STRIP, CARD_H]);
    expect(cards.map((card) => card.covered)).toEqual([true, true, false]);
  });

  it('overlaps the cards for real: each card begins inside the one before it, not below it', () => {
    const { cards, cardHeight } = stackLayout(WALLET);
    for (let at = 1; at < cards.length; at += 1) {
      expect(cards[at]!.top).toBeLessThan(cards[at - 1]!.top + cardHeight);
      // And what the card before shows is exactly its top band.
      expect(cards[at]!.top - cards[at - 1]!.top).toBe(STRIP);
    }
  });

  it('needs exactly the room the overlap asks for', () => {
    expect(stackLayout(WALLET).height).toBe(STRIP * 2 + CARD_H);
    expect(stackLayout(WALLET).width).toBe(CARD_W);
    expect(stackLayout(['one']).height).toBe(CARD_H);
  });

  it('draws every card at one width, a phone’s column or a desktop’s fixed card', () => {
    const phone = stackLayout(WALLET, { cardWidth: 358 });
    expect(phone.cardWidth).toBe(358);
    expect(phone.cardHeight).toBe(cardHeightFor(358));
    expect(cardHeightFor(358)).toBe(226);
    expect(phone.height).toBe(STRIP * 2 + 226);
    const desktop = stackLayout(WALLET, { cardWidth: DESKTOP_CARD_W });
    expect(desktop.width).toBe(DESKTOP_CARD_W);
    expect(desktop.cardHeight).toBe(cardHeightFor(DESKTOP_CARD_W));
  });

  it('keeps every card in its slot at rest', () => {
    const { cards, raised } = stackLayout(WALLET);
    expect(raised).toBeNull();
    expect(cards.map((card) => card.place)).toEqual(['slot', 'slot', 'slot']);
  });

  it('raises an open card to the top, whole, at the same width, and hides the rest', () => {
    const rest = stackLayout(WALLET, { cardWidth: 358 });
    const layout = stackLayout(WALLET, { raised: 1, cardWidth: 358 });
    expect(layout.raised).toBe(1);
    expect(layout.front).toBe(1);
    expect(layout.cardWidth).toBe(rest.cardWidth);
    expect(layout.cards.map((card) => card.place)).toEqual(['hidden', 'raised', 'hidden']);
    expect(layout.cards[1]).toMatchObject({ top: 0, visible: cardHeightFor(358), covered: false });
    // Nothing of the others shows while a card is open.
    expect(layout.cards[0]!.visible).toBe(0);
    expect(layout.cards[2]!.visible).toBe(0);
    expect(layout.cards[1]!.zIndex).toBeGreaterThan(Math.max(layout.cards[0]!.zIndex, layout.cards[2]!.zIndex));
  });

  it('keeps each hidden card’s slot, so closing puts every card back where it was', () => {
    const rest = stackLayout(WALLET);
    const open = stackLayout(WALLET, { raised: 2 });
    expect(open.cards.filter((card) => card.place === 'hidden').map((card) => card.top)).toEqual(rest.cards.slice(0, 2).map((card) => card.top));
    expect(stackLayout(WALLET, { raised: null })).toEqual(rest);
  });

  it('takes no room in the page while a card is raised, since the raised card sits over the slot its page leaves', () => {
    expect(stackLayout(WALLET, { raised: 0 }).height).toBe(0);
  });

  it('drops the others into a pile, back to front: the front card lowest and whole width, each behind it a step higher and narrower', () => {
    const open = stackLayout(WALLET, { raised: 1 });
    expect(open.cards[1]!.pile).toBeUndefined();
    expect(open.cards[0]!.pile).toEqual({ top: 0, scale: 1 - PILE_SHRINK });
    expect(open.cards[2]!.pile).toEqual({ top: PILE_STEP, scale: 1 });
    expect(stackLayout(WALLET).cards.every((card) => card.pile === undefined)).toBe(true);
  });

  it('ignores a raised card it does not have', () => {
    expect(stackLayout(WALLET, { raised: 9 })).toEqual(stackLayout(WALLET));
  });
});

describe('pilePlace', () => {
  it('shows a few edges and tucks the rest behind the last one', () => {
    const places = Array.from({ length: 7 }, (_, at) => pilePlace(at, 7));
    expect(places.map((place) => place.top)).toEqual([0, 0, 0, 0, PILE_STEP, PILE_STEP * 2, PILE_STEP * 3]);
    expect(new Set(places.map((place) => place.top)).size).toBe(PILE_EDGES);
    expect(places.at(-1)).toEqual({ top: PILE_STEP * (PILE_EDGES - 1), scale: 1 });
  });

  it('peeks: the front card’s strip and one step for each edge behind it, up to the edges shown', () => {
    expect(PILE_PEEK).toBeGreaterThan(0);
    expect(pileHeight(0)).toBe(0);
    expect(pileHeight(1)).toBe(PILE_PEEK);
    expect(pileHeight(3)).toBe(PILE_PEEK + 2 * PILE_STEP);
    expect(pileHeight(12)).toBe(PILE_PEEK + (PILE_EDGES - 1) * PILE_STEP);
  });

  it('is one card at the line, whole, when only one is left', () => {
    expect(pilePlace(0, 1)).toEqual({ top: 0, scale: 1 });
  });
});

/** Which faces print only their top band: every covered card, and never the card in front. */
describe('faceIsBehind', () => {
  it('draws every covered card as its band and the front card whole', () => {
    const { cards } = stackLayout(WALLET);
    expect(cards.map((card) => faceIsBehind(card))).toEqual([true, true, false]);
  });

  it('prints the raised card whole, and every hidden card as its band', () => {
    const { cards } = stackLayout(WALLET, { raised: 1 });
    expect(cards.map((card) => faceIsBehind(card))).toEqual([true, false, true]);
  });
});

describe('cardsBeforeScrolling', () => {
  it('shows six or seven cards in the room a phone screen leaves the stack, which is what C3 was chosen on', () => {
    expect(cardsBeforeScrolling(460)).toBe(6);
    expect(cardsBeforeScrolling(520)).toBe(7);
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
