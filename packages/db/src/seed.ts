export const SYSTEM_ACCOUNTS = [
  { key: 'opening_balance', name: 'Opening Balances' },
  { key: 'currency_exchange', name: 'Currency Exchange' },
  // The other side of a balance fixed to what was counted, when the difference is not spending or income. Added after
  // workspaces existed, so it is also made on first use (`ensureSystemAccountTx`) rather than only here.
  { key: 'balance_correction', name: 'Balance corrections' },
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

/** Each default set category's icon, by its name: a set's categories have no key of their own to take one from. */
export const SET_CATEGORY_ICONS: Readonly<Record<string, string>> = {
  Flights: 'plane',
  Lodging: 'bed',
  Activities: 'map-pin',
  Transport: 'train-front',
  Meals: 'utensils',
  Shopping: 'shopping-bag',
  Souvenirs: 'gift',
  Miscellaneous: 'circle-ellipsis',
  'Business H': 'briefcase',
  Intercity: 'bus',
  Photo: 'camera',
  Postpartum: 'heart-pulse',
  Sleeping: 'bed',
  Feeding: 'milk',
  Diapering: 'baby',
  Bathing: 'bath',
  Clothing: 'shirt',
  Medical: 'stethoscope',
  Weaning: 'apple',
  Travelling: 'car',
  Playing: 'blocks',
  Vaccination: 'syringe',
  'Design & Planning': 'notebook-pen',
  'Structural Construction': 'hard-hat',
  'Cabinetry & Hardware': 'hammer',
  'Home Appliances': 'microwave',
  'Installation & Labor': 'wrench',
  'Plumbing Fixtures': 'shower-head',
  'Flooring & Tiles': 'paint-bucket',
  'Lighting & Sockets': 'lightbulb',
  Landscape: 'plant-pot',
};
