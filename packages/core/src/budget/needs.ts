import { DEFAULT_CATEGORIES } from '../categories/defaults';

/**
 * What a spending category counts as. Essential and Lifestyle are spending; Debts & savings (owner, 16 Nov 2026) is
 * spending that pays a debt down or puts money by — insurance, donations, loan interest — and counts with what was not
 * spent at all.
 */
export type CategoryNeed = 'essential' | 'lifestyle' | 'debts_savings';
export const CATEGORY_NEEDS: readonly CategoryNeed[] = ['essential', 'lifestyle', 'debts_savings'];

export interface NeedNode {
  id: string;
  parentId: string | null;
  /** A built-in category's stable key (0027, kept per book by 0043): what its default mark is found by. */
  systemKey?: string | null;
}

export interface ResolvedNeed {
  need: CategoryNeed;
  /**
   * Its own mark, an ancestor's, the built-in default for its key (or an ancestor's key), or none at all — in which
   * case it counts as essential.
   */
  source: 'yours' | 'parent' | 'default' | null;
}

const expenseKeys = (top: string): string[] => {
  const category = DEFAULT_CATEGORIES.find((c) => c.key === top && c.kind === 'expense');
  return category ? [category.key, ...(category.children ?? []).map((child) => child.key)] : [];
};

/*
 * The built-in marks (owner, 16 Nov 2026), by system key: a code-level default, never written, so nothing is stored or
 * synced and any mark set on the category or an ancestor wins. A key not here falls back to its ancestors' keys, then
 * to essential. Every child key is named, so a built-in category keeps its default wherever it is moved or renamed.
 */
const LIFESTYLE = [
  'food_beverage.takeaways',
  'food_beverage.restaurants',
  'food_beverage.cafe_dessert',
  ...expenseKeys('personal_care'),
  ...expenseKeys('entertainment'),
  ...expenseKeys('shopping'),
  ...expenseKeys('gift_giving'),
  ...expenseKeys('travel'),
];
const DEBTS_SAVINGS = [...expenseKeys('protection'), ...expenseKeys('donation'), 'miscellaneous.interest'];
const ESSENTIAL = [
  ...['utilities', 'household', 'transportation', 'property', 'health_care', 'education', 'government_taxes', 'business'].flatMap(expenseKeys),
  ...expenseKeys('miscellaneous').filter((key) => key !== 'miscellaneous.interest'),
  'food_beverage.home_catering',
  'food_beverage.school_catering',
];

export const DEFAULT_CATEGORY_NEEDS: Readonly<Record<string, CategoryNeed>> = Object.freeze({
  ...Object.fromEntries(ESSENTIAL.map((key) => [key, 'essential' as const])),
  ...Object.fromEntries(LIFESTYLE.map((key) => [key, 'lifestyle' as const])),
  ...Object.fromEntries(DEBTS_SAVINGS.map((key) => [key, 'debts_savings' as const])),
});

/** The built-in mark for a system key, or undefined for a key with none (and for no key). */
export function defaultNeedOfKey(key: string | null | undefined): CategoryNeed | undefined {
  return key ? DEFAULT_CATEGORY_NEEDS[key] : undefined;
}

/** A stored mark read back: anything this build does not know reads as no mark. */
export function readNeed(value: unknown): CategoryNeed | undefined {
  return CATEGORY_NEEDS.includes(value as CategoryNeed) ? (value as CategoryNeed) : undefined;
}

interface Tree {
  parentOf: ReadonlyMap<string, string | null>;
  keyOf: ReadonlyMap<string, string | null | undefined>;
}

/** The category, then each ancestor nearest first; stops on a cycle rather than looping. */
function chain(categoryId: string, tree: Tree): string[] {
  const out = [categoryId];
  const seen = new Set<string>(out);
  let parent = tree.parentOf.get(categoryId) ?? null;
  while (parent !== null && !seen.has(parent)) {
    out.push(parent);
    seen.add(parent);
    parent = tree.parentOf.get(parent) ?? null;
  }
  return out;
}

/** Own mark > nearest ancestor's mark > the default for its own key, then its ancestors' keys > essential. */
function walk(categoryId: string, tree: Tree, marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  const line = chain(categoryId, tree);
  for (const [i, id] of line.entries()) {
    const mark = readNeed(marks[id]);
    if (mark) return { need: mark, source: i === 0 ? 'yours' : 'parent' };
  }
  for (const id of line) {
    const fallback = defaultNeedOfKey(tree.keyOf.get(id));
    if (fallback) return { need: fallback, source: 'default' };
  }
  // Unmarked counts as a need: an emergency fund sized a little large is the safe mistake.
  return { need: 'essential', source: null };
}

const treeOf = (nodes: readonly NeedNode[]): Tree => ({
  parentOf: new Map(nodes.map((node) => [node.id, node.parentId])),
  keyOf: new Map(nodes.map((node) => [node.id, node.systemKey])),
});

/** A category's need: its own mark, else its nearest marked ancestor's, else the built-in default by key, else essential. */
export function needOf(categoryId: string, nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  return walk(categoryId, treeOf(nodes), marks);
}

/** Every node's need, the tree read once. */
export function resolveNeeds(nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): Record<string, CategoryNeed> {
  const tree = treeOf(nodes);
  return Object.fromEntries(nodes.map((node) => [node.id, walk(node.id, tree, marks).need]));
}
