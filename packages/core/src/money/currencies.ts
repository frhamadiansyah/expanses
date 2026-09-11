export interface CurrencyInfo {
  code: string;
  exponent: number;
  symbol: string;
  name: string;
}

// IDR exponent is 0 by product decision (spec §5), not ISO 4217.
const LIST: CurrencyInfo[] = [
  { code: 'IDR', exponent: 0, symbol: 'Rp', name: 'Indonesian Rupiah' },
  { code: 'USD', exponent: 2, symbol: '$', name: 'US Dollar' },
  { code: 'SGD', exponent: 2, symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'MYR', exponent: 2, symbol: 'RM', name: 'Malaysian Ringgit' },
  { code: 'THB', exponent: 2, symbol: '฿', name: 'Thai Baht' },
  { code: 'CNY', exponent: 2, symbol: 'CN¥', name: 'Chinese Yuan' },
  { code: 'JPY', exponent: 0, symbol: '¥', name: 'Japanese Yen' },
  { code: 'KRW', exponent: 0, symbol: '₩', name: 'South Korean Won' },
  { code: 'HKD', exponent: 2, symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'PHP', exponent: 2, symbol: '₱', name: 'Philippine Peso' },
  { code: 'AUD', exponent: 2, symbol: 'A$', name: 'Australian Dollar' },
  { code: 'EUR', exponent: 2, symbol: '€', name: 'Euro' },
  { code: 'GBP', exponent: 2, symbol: '£', name: 'British Pound' },
  { code: 'KWD', exponent: 3, symbol: 'KD', name: 'Kuwaiti Dinar' },
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
