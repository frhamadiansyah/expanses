import type { CatalogEntry } from '@expanses/catalog';
import { DEFAULT_CATEGORIES } from '@expanses/core';

/** Entries whose bank and name together contain every word of the query, sorted by bank then name. */
export function searchCatalog(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => {
      const text = `${entry.bank} ${entry.name}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => `${a.bank}|${a.name}`.localeCompare(`${b.bank}|${b.name}`));
}

const CATEGORY_NAMES = new Map<string, string>(
  DEFAULT_CATEGORIES.flatMap((category) => [
    [category.key, category.name] as [string, string],
    ...(category.children ?? []).map((child): [string, string] => [child.key, child.name]),
  ]),
);

export const categoryNameForKey = (key: string) => CATEGORY_NAMES.get(key) ?? key;
