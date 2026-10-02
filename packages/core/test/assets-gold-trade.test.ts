import { describe, expect, it } from 'vitest';
import { GOLD_BAR_SIZES, goldBarSizes, goldBrandOf, goldGainMinor, goldSellGrams, gramsMicro, gramsText, typedGramsMicro } from '../src/index';

describe('gold bars by brand', () => {
  it('lists each brand’s own sizes', () => {
    expect(GOLD_BAR_SIZES.Antam).toEqual([0.5, 1, 2, 3, 5, 10, 25, 50, 100, 250, 500, 1000]);
    expect(GOLD_BAR_SIZES.UBS).toEqual([0.5, 1, 2, 3, 4, 5, 10, 25, 50, 100]);
    expect(GOLD_BAR_SIZES.Galeri24).toEqual([0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]);
  });

  it('reads the brand from the holding’s name, and offers every size when it names none', () => {
    expect(goldBrandOf('Antam gold bars')).toBe('Antam');
    expect(goldBrandOf('Logam Mulia 10 g')).toBe('Antam');
    expect(goldBrandOf('UBS gold bars')).toBe('UBS');
    expect(goldBrandOf('Galeri 24 gold')).toBe('Galeri24');
    expect(goldBrandOf('Galeri24')).toBe('Galeri24');
    expect(goldBrandOf('Gold bars')).toBeNull();
    expect(goldBarSizes('UBS gold bars')).toEqual(GOLD_BAR_SIZES.UBS);
    expect(goldBarSizes('Gold bars')).toEqual([0.5, 1, 2, 3, 4, 5, 10, 25, 50, 100, 250, 500, 1000]);
    expect(goldBarSizes('Antam').map(gramsText).slice(0, 2)).toEqual(['0,5', '1']);
    expect(gramsText(1000)).toBe('1.000');
  });
});

describe('a gold buy or sell by weight', () => {
  it('reads typed grams with an id-ID comma', () => {
    expect(typedGramsMicro('0,5')).toBe(500_000);
    expect(typedGramsMicro('12')).toBe(12_000_000);
    expect(typedGramsMicro('')).toBeNull();
    expect(typedGramsMicro('0')).toBeNull();
    expect(typedGramsMicro('abc')).toBeNull();
    expect(gramsMicro(0.5)).toBe(500_000);
  });

  it('All sells exactly the grams held; more than is held is refused', () => {
    expect(goldSellGrams({ typedMicro: null, all: true, heldMicro: 12_000_000 })).toEqual({ unitsMicro: 12_000_000, tooMany: false });
    expect(goldSellGrams({ typedMicro: 13_000_000, all: false, heldMicro: 12_000_000 })).toEqual({ unitsMicro: 13_000_000, tooMany: true });
    expect(goldSellGrams({ typedMicro: 2_000_000, all: false, heldMicro: 12_000_000 })).toEqual({ unitsMicro: 2_000_000, tooMany: false });
    expect(goldSellGrams({ typedMicro: null, all: false, heldMicro: 12_000_000 })).toBeNull();
  });

  it('gains what was received less the average cost of the grams sold', () => {
    const position = { unitsMicro: 12_000_000, costMinor: 22_500_000, realizedMinor: 0, incomeMinor: 0, byYear: {} };
    expect(goldGainMinor(position, 2_000_000, 3_640_000)).toBe(-110_000);
    expect(goldGainMinor(position, 12_000_000, 24_000_000)).toBe(1_500_000);
  });
});
