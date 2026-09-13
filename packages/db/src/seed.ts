export const SYSTEM_ACCOUNTS = [
  { key: 'opening_balance', name: 'Opening Balances' },
  { key: 'currency_exchange', name: 'Currency Exchange' },
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[number]['key'];

// The default category tree lives in core so the catalogue can validate category keys without depending on db.
export { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_KEYS, type DefaultCategory } from '@expanses/core';

/**
 * Category sets every workspace starts with.
 *
 * Sets are seeded on open rather than at workspace creation: a workspace can predate the sets
 * feature, and the creation path has to keep working against databases stopped at older versions.
 */
export const DEFAULT_CATEGORY_SETS: readonly { name: string; categories: readonly string[] }[] = [
  {
    name: 'Holiday',
    categories: ['Flights', 'Lodging', 'Activities', 'Transport', 'Meals', 'Shopping', 'Souvenirs', 'Miscellaneous', 'Business H', 'Intercity', 'Photo'],
  },
  {
    name: 'Newborn',
    categories: ['Postpartum', 'Sleeping', 'Feeding', 'Diapering', 'Bathing', 'Clothing', 'Medical', 'Weaning', 'Travelling', 'Playing', 'Vaccination'],
  },
  {
    name: 'Renovation',
    categories: [
      'Design & Planning', 'Structural Construction', 'Cabinetry & Hardware', 'Home Appliances', 'Installation & Labor',
      'Plumbing Fixtures', 'Flooring & Tiles', 'Lighting & Sockets', 'Landscape', 'Miscellaneous',
    ],
  },
];
