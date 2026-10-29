import { CURRENCIES, currencyInfo } from '@expanses/core';

/**
 * An amount as the cost form writes it: the currency's symbol, one space, the figure grouped in id-ID —
 * "Rp 200.000", "€ 95,00", "₺ 1.800,50" — the same symbol Price each carries at its left.
 *
 * `formatMinor` is not used because the locale decides its symbol and its gap: lira come out as the code "TRY",
 * euros with no gap, rupiah with a no-break space.
 */
export function spacedMinor(amountMinor: number, currency: string): string {
  const { exponent } = currencyInfo(currency);
  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const figure = new Intl.NumberFormat('id-ID', { minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(amountMinor / 10 ** exponent);
  return `${symbol} ${figure}`;
}
