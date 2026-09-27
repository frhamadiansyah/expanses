import { listCategoryMccs } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The card MCCs set on categories themselves; `categoryMcc` works out what each one inherits. */
export function useCategoryMccs() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-mccs', ws.workspaceId], queryFn: () => listCategoryMccs(database, ws) });
}
