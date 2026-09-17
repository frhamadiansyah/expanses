import { categorySetMembership, listCategorySets, listSetCategories, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/**
 * The sets the open book can draw on. Events span books, so their screens ask for every set in the workspace
 * (`ownerWide`) — an event may use a set filed in any book.
 */
export function useCategorySets({ ownerWide = false }: { ownerWide?: boolean } = {}) {
  const { database, ws } = useApp();
  const scope = ownerWide ? ownerScope(ws) : ws;
  return useQuery({ queryKey: ['category-sets', ws.workspaceId, scope.bookId ?? null], queryFn: () => listCategorySets(database, scope) });
}

/**
 * Which set each category belongs to, keyed by category id.
 *
 * Every monthly surface reads this to leave set categories out: a renovation should not clutter the
 * list you pick from to record the weekly shop.
 */
export function useCategorySetMembership() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-set-membership', ws.workspaceId], queryFn: () => categorySetMembership(database, ws) });
}

export function useSetCategories(setId: string | null) {
  const { database, ws } = useApp();
  return useQuery({
    queryKey: ['set-categories', ws.workspaceId, setId],
    queryFn: () => listSetCategories(database, ws, setId!),
    enabled: setId !== null,
  });
}
