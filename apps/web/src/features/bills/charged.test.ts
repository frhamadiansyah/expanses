import { groupedMajorString, parseGroupedMajor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { chargedEstimateText } from './charged';

describe('the charged estimate, written as the grouped field shows it', () => {
  it('reads back to the same minor units in a currency with cents and one without', () => {
    const rates = { SGD: 12_500, USD: 16_000 };
    const idr = chargedEstimateText({ amountMinor: 12_000, billCurrency: 'SGD', payerCurrency: 'IDR', rates, baseCurrency: 'IDR' });
    expect(idr).toBe('1.500.000');
    expect(parseGroupedMajor(idr, 'IDR')).toBe(1_500_000);

    const usd = chargedEstimateText({ amountMinor: 1_000_000, billCurrency: 'IDR', payerCurrency: 'USD', rates, baseCurrency: 'IDR' });
    expect(usd).toBe(groupedMajorString(parseGroupedMajor(usd, 'USD'), 'USD'));
    expect(usd).toContain(',');
  });
});
