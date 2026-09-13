import { isoDate } from '@expanses/core';
import { dueExpenseTemplates, listExpenseTemplates } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

export function useExpenseTemplates() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['expense-templates', ws.workspaceId], queryFn: () => listExpenseTemplates(database, ws) });
}

/** Bills whose day has passed this month with nothing recorded against them. Asked when the page opens. */
export function useDueBills() {
  const { database, ws } = useApp();
  const today = isoDate();
  return useQuery({ queryKey: ['bills-due', ws.workspaceId, today], queryFn: () => dueExpenseTemplates(database, ws, today) });
}
