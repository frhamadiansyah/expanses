export type CategoryNeed = 'essential' | 'lifestyle';
export const CATEGORY_NEEDS: readonly CategoryNeed[] = ['essential', 'lifestyle'];

export interface NeedNode {
  id: string;
  parentId: string | null;
}

export interface ResolvedNeed {
  need: CategoryNeed;
  /** Its own mark, an ancestor's, or none at all — in which case it counts as essential. */
  source: 'yours' | 'parent' | null;
}

function walk(categoryId: string, parentOf: ReadonlyMap<string, string | null>, marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  const own = marks[categoryId];
  if (own) return { need: own, source: 'yours' };
  const seen = new Set<string>([categoryId]);
  let parent = parentOf.get(categoryId) ?? null;
  while (parent !== null && !seen.has(parent)) {
    const mark = marks[parent];
    if (mark) return { need: mark, source: 'parent' };
    seen.add(parent);
    parent = parentOf.get(parent) ?? null;
  }
  // Unmarked counts as a need: an emergency fund sized a little large is the safe mistake.
  return { need: 'essential', source: null };
}

/** A category's own mark, else its nearest marked ancestor's, else essential. */
export function needOf(categoryId: string, nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): ResolvedNeed {
  return walk(categoryId, new Map(nodes.map((node) => [node.id, node.parentId])), marks);
}

/** Every node's need, the tree read once. */
export function resolveNeeds(nodes: readonly NeedNode[], marks: Readonly<Record<string, CategoryNeed>>): Record<string, CategoryNeed> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  return Object.fromEntries(nodes.map((node) => [node.id, walk(node.id, parentOf, marks).need]));
}
