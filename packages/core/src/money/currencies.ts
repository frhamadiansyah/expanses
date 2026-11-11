export interface CurrencyInfo {
  code: string;
  exponent: number;
  symbol: string;
  name: string;
  flag: string;
  /** English names of the countries that use it, so a search by country finds the currency. */
  countries: string[];
}

// IDR exponent is 0 by product decision (spec §5), not ISO 4217.
const LIST: CurrencyInfo[] = [
  { code: 'IDR', exponent: 0, symbol: 'Rp', name: 'Indonesian Rupiah', flag: '🇮🇩', countries: ['Indonesia'] },
  { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar', flag: '🇺🇸', countries: ['United States', 'Ecuador', 'El Salvador', 'Timor-Leste', 'Panama', 'Puerto Rico', 'Guam'] },
  { code: 'SGD', exponent: 2, symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬', countries: ['Singapore'] },
  { code: 'MYR', exponent: 2, symbol: 'RM', name: 'Malaysian Ringgit', flag: '🇲🇾', countries: ['Malaysia'] },
  { code: 'THB', exponent: 2, symbol: '฿', name: 'Thai Baht', flag: '🇹🇭', countries: ['Thailand'] },
  { code: 'CNY', exponent: 2, symbol: 'CN¥', name: 'Chinese Yuan', flag: '🇨🇳', countries: ['China'] },
  { code: 'JPY', exponent: 0, symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵', countries: ['Japan'] },
  { code: 'KRW', exponent: 0, symbol: '₩', name: 'South Korean Won', flag: '🇰🇷', countries: ['South Korea', 'Korea'] },
  { code: 'KHR', exponent: 0, symbol: '៛', name: 'Cambodian Riel', flag: '🇰🇭', countries: ['Cambodia'] },
  { code: 'LKR', exponent: 2, symbol: 'Rs', name: 'Sri Lankan Rupee', flag: '🇱🇰', countries: ['Sri Lanka'] },
  { code: 'VND', exponent: 0, symbol: '₫', name: 'Vietnamese Dong', flag: '🇻🇳', countries: ['Vietnam', 'Viet Nam'] },
  { code: 'HKD', exponent: 2, symbol: 'HK$', name: 'Hong Kong Dollar', flag: '🇭🇰', countries: ['Hong Kong'] },
  { code: 'TWD', exponent: 2, symbol: 'NT$', name: 'New Taiwan Dollar', flag: '🇹🇼', countries: ['Taiwan'] },
  { code: 'PHP', exponent: 2, symbol: '₱', name: 'Philippine Peso', flag: '🇵🇭', countries: ['Philippines'] },
  { code: 'AUD', exponent: 2, symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺', countries: ['Australia', 'Kiribati', 'Nauru', 'Tuvalu'] },
  { code: 'NZD', exponent: 2, symbol: 'NZ$', name: 'New Zealand Dollar', flag: '🇳🇿', countries: ['New Zealand', 'Cook Islands'] },
  { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro', flag: '🇪🇺', countries: ['Austria', 'Belgium', 'Croatia', 'Cyprus', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain'] },
  { code: 'GBP', exponent: 2, symbol: '£', name: 'British Pound', flag: '🇬🇧', countries: ['United Kingdom', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Great Britain'] },
  { code: 'TRY', exponent: 2, symbol: '₺', name: 'Turkish Lira', flag: '🇹🇷', countries: ['Turkey', 'Turkiye'] },
  { code: 'SAR', exponent: 2, symbol: 'SR', name: 'Saudi Riyal', flag: '🇸🇦', countries: ['Saudi Arabia'] },
  { code: 'KWD', exponent: 3, symbol: 'KD', name: 'Kuwaiti Dinar', flag: '🇰🇼', countries: ['Kuwait'] },
];

export const CURRENCIES: readonly CurrencyInfo[] = LIST;

const BY_CODE = new Map(LIST.map((c) => [c.code, c]));

export class UnknownCurrencyError extends Error {
  constructor(code: string) {
    super(`Unknown currency: ${code}`);
    this.name = 'UnknownCurrencyError';
  }
}

export function currencyInfo(code: string): CurrencyInfo {
  const info = BY_CODE.get(code);
  if (!info) throw new UnknownCurrencyError(code);
  return info;
}

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * Currencies matching what was typed: by code, name, symbol or the name of a country that uses it. Case is ignored;
 * an empty query matches everything. Code matches come first, then the rest in list order.
 */
export function searchCurrencies(query: string, list: readonly CurrencyInfo[] = CURRENCIES): CurrencyInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...list];
  const hit = (c: CurrencyInfo) =>
    c.code.toLowerCase().includes(needle) ||
    c.name.toLowerCase().includes(needle) ||
    c.symbol.toLowerCase().includes(needle) ||
    c.countries.some((country) => country.toLowerCase().includes(needle));
  const found = list.filter(hit);
  const byCode = found.filter((c) => c.code.toLowerCase().startsWith(needle));
  return [...byCode, ...found.filter((c) => !byCode.includes(c))];
}
