export const SYSTEM_ACCOUNTS = [
  { key: 'opening_balance', name: 'Opening Balances' },
  { key: 'currency_exchange', name: 'Currency Exchange' },
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]['key'];

// The default category tree lives in core so the catalogue can validate category keys without depending on db.
export { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_KEYS, type DefaultCategory } from '@expanses/core';
