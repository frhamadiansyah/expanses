import { categoryDefaultMcc, DEFAULT_CATEGORY_MCCS } from '@expanses/core';

type CategoryLike = { id: string; parentId: string | null; systemKey: string | null };

/** A category's card MCC and where it comes from: your override, the built-in default for its key, or its parent. */
export function categoryMcc(
  category: CategoryLike,
  categories: readonly CategoryLike[],
  overrides: Readonly<Record<string, string>>,
): { mcc: string | null; source: 'yours' | 'default' | 'parent' | null } {
  const own = overrides[category.id];
  if (own) return { mcc: own, source: 'yours' };
  const builtIn = category.systemKey ? DEFAULT_CATEGORY_MCCS[category.systemKey] : undefined;
  if (builtIn) return { mcc: builtIn, source: 'default' };
  const inherited = categoryDefaultMcc(category.id, categories, overrides);
  return inherited ? { mcc: inherited, source: 'parent' } : { mcc: null, source: null };
}
