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

/** Levels the entry publishes, in the order the bank lists them. Empty when earning does not depend on standing. */
export const memberLevelsOf = (entry: CatalogEntry) => entry.program.memberLevels ?? [];

/**
 * Whether the entry can be applied yet. A card that earns by the holder's standing needs that standing chosen
 * first, or it would be written with no base rule at all.
 */
export function canApplyEntry(entry: CatalogEntry, memberLevel: string | null): boolean {
  const levels = memberLevelsOf(entry);
  return levels.length === 0 || levels.some((level) => level.key === memberLevel);
}
