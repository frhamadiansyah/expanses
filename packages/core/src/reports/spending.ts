export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface CategoryAmount {
  accountId: string;
  amountBaseMinor: number;
}

export interface CategoryTreeNode {
  id: string;
  name: string;
  ownMinor: number;
  totalMinor: number;
  children: CategoryTreeNode[];
}

/** Rolls category amounts up the tree. Zero-total branches are pruned; siblings sort by total descending. */
export function categoryTree(categories: CategoryNode[], amounts: CategoryAmount[]): CategoryTreeNode[] {
  const own = new Map<string, number>();
  for (const a of amounts) own.set(a.accountId, (own.get(a.accountId) ?? 0) + a.amountBaseMinor);

  const childrenOf = new Map<string | null, CategoryNode[]>();
  const ids = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    const parent = c.parentId !== null && ids.has(c.parentId) ? c.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }

  const build = (node: CategoryNode, seen: Set<string>): CategoryTreeNode | null => {
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    const children = (childrenOf.get(node.id) ?? [])
      .map((child) => build(child, seen))
      .filter((c): c is CategoryTreeNode => c !== null);
    const ownMinor = own.get(node.id) ?? 0;
    const totalMinor = ownMinor + children.reduce((s, c) => s + c.totalMinor, 0);
    if (totalMinor === 0 && children.length === 0) return null;
    return { id: node.id, name: node.name, ownMinor, totalMinor, children: sortNodes(children) };
  };

  const seen = new Set<string>();
  return sortNodes(
    (childrenOf.get(null) ?? []).map((root) => build(root, seen)).filter((n): n is CategoryTreeNode => n !== null),
  );
}

function sortNodes(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
}

/** id -> ancestor ids, nearest first. */
export function categoryAncestors(categories: CategoryNode[]): Record<string, string[]> {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const result: Record<string, string[]> = {};
  for (const c of categories) {
    const chain: string[] = [];
    let current = c.parentId;
    while (current !== null && current !== undefined && !chain.includes(current)) {
      chain.push(current);
      current = parentOf.get(current) ?? null;
    }
    result[c.id] = chain;
  }
  return result;
}

/** Leaf-first display path, e.g. "Food & Drink › Groceries". */
export function categoryPath(categories: CategoryNode[], id: string): string {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const names: string[] = [];
  let current = byId.get(id);
  while (current && names.length < 10) {
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(' › ');
}
