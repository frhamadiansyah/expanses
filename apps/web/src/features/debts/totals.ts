import { sumToBase } from '@expanses/core';
import type { PersonDebtRow } from '@expanses/db';

/**
 * One side of the ledger in the base currency: each person's card converted at the held rate — or no figure, with
 * the missing rate named. Never their minor units added as they are, which counts US$100 as Rp 10.000.
 */
export const sideTotal = (people: readonly PersonDebtRow[], baseCurrency: string, ratesToBase: Readonly<Record<string, number>>) =>
  sumToBase({ amounts: people.map((person) => ({ minor: person.totalMinor, currency: person.currency })), baseCurrency, ratesToBase });
