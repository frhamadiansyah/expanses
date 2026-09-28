import { categoryUsage, listCategoryMccs } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The card MCCs set on categories themselves; `categoryMcc` works out what each one inherits. */
export function useCategoryMccs() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-mccs', ws.workspaceId], queryFn: () => listCategoryMccs(database, ws) });
}

/**
 * What uses a category, and whether it may be deleted: the page offers Delete only when nothing does. Decided by
 * `categoryUsage` in the database layer; every write invalidates it with everything else.
 */
export function useCategoryUsage(categoryId: string, enabled: boolean) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-usage', ws.workspaceId, categoryId], queryFn: () => categoryUsage(database, ws, categoryId), enabled });
}
