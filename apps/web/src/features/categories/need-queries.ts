import { listCategoryNeeds, phonesBehindThirdMark } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** The marks set on categories themselves; `needOf` works out what each line inherits. */
export function useCategoryNeeds() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['category-needs', ws.workspaceId], queryFn: () => listCategoryNeeds(database, ws) });
}

/** The other phones of the open shared workspace that cannot take a Debts & savings mark yet (an older build). */
export function usePhonesBehindThirdMark() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['phones-behind-third-mark', ws.workspaceId, ws.bookId ?? null], queryFn: () => phonesBehindThirdMark(database, ws) });
}
