import { listCategoryNeeds } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The marks set on categories themselves; `needOf` works out what each line inherits. */
export function useCategoryNeeds() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-needs', ws.workspaceId], queryFn: () => listCategoryNeeds(database, ws) });
}
