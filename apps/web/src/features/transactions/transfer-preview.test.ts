import { describe, expect, it } from 'vitest';
import { transferPreviewOf } from './transfer-preview';

/* §7's transfer between currencies, before Save. Invented figures. */
const plain = (text: string | null | undefined) => text?.replace(/ /g, ' ') ?? null;
const cost = (costBaseMinor: number | null) => ({ currency: 'TRY', costBaseMinor, coveredMinor: 50_000, coveredCostBaseMinor: costBaseMinor ?? 0, uncoveredMinor: 0, ratePerUnit: 525, lots: [] });

describe('transferPreviewOf', () => {
  it('into a foreign pocket from the base currency: only the Rate row', () => {
    const preview = transferPreviewOf({ fromMinor: 5_250_000, fromCurrency: 'IDR', toMinor: 1_000_000, toCurrency: 'TRY', fromHoldsLots: false, baseCurrency: 'IDR', ratesToBase: { TRY: 512 }, stale: false, cost: null });
    expect(plain(preview.rateText)).toBe('Rp 525 per TRY (market 512, +2,5 %)');
    expect(preview.result).toBeNull();
    expect(preview.costText).toBeNull();
  });

  it('out of a foreign pocket: Rate, Cost and the exchange result', () => {
    const preview = transferPreviewOf({ fromMinor: 50_000, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', fromHoldsLots: true, baseCurrency: 'IDR', ratesToBase: { TRY: 512 }, stale: false, cost: cost(262_500) });
    expect(plain(preview.costText)).toBe('Rp 262.500');
    expect(preview.result?.title).toBe('Exchange loss');
    expect(preview.gainLossBaseMinor).toBe(-12_500);
  });

  it('nothing before both figures are typed', () => {
    expect(transferPreviewOf({ fromMinor: null, fromCurrency: 'TRY', toMinor: 250_000, toCurrency: 'IDR', fromHoldsLots: true, baseCurrency: 'IDR', ratesToBase: {}, stale: false, cost: null })).toEqual({ rateText: null, costText: null, result: null, stale: false, gainLossBaseMinor: null });
  });
});
