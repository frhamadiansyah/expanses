import { listExpenseTemplates } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useExpenseTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['expense-templates', ws.workspaceId, ws.bookId ?? null], queryFn: () => listExpenseTemplates(database, ws) });
}
