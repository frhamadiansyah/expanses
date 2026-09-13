import { categorySetMembership, listCategorySets, listSetCategories } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The sets this workspace can draw on. */
export function useCategorySets() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-sets', ws.workspaceId], queryFn: () => listCategorySets(database, ws) });
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
