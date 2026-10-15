import { foreignCostPreview, foreignLots, withdrawalsUsedBy } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../app/context';

/*
 * The withdrawal rate's reads (spec §7). Every write ends in `useInvalidateAll`, which invalidates every query, so these
 * keys need no list of their own to be refreshed by.
 */

/** What spending `amountMinor` from a foreign account would cost, before Save (R20). Idle until there is an amount. */
export function useForeignCostPreview(input: { accountId: string; amountMinor: number | null; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null }) {
  const { database, ws } = useApp();
  const enabled = !!input.accountId && input.amountMinor !== null && input.amountMinor > 0;
  return useQuery({
    queryKey: ['fx-preview', ws.workspaceId, input.accountId, input.amountMinor, input.occurredOn, input.excludeTransactionId ?? null, input.dayRate ?? null],
    enabled,
    queryFn: () =>
      foreignCostPreview(database, ws, { accountId: input.accountId, amountMinor: input.amountMinor!, occurredOn: input.occurredOn, excludeTransactionId: input.excludeTransactionId ?? null, dayRate: input.dayRate ?? null }),
  });
}

/** The withdrawals still held in a foreign account (the account page). */
export function useForeignLots(accountId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fx-lots', ws.workspaceId, accountId], enabled: !!accountId, queryFn: () => foreignLots(database, ws, accountId!) });
}

/** Which withdrawals a transaction's foreign money came from (the receipt). */
export function useWithdrawalsUsed(transactionId: string | null) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fx-used', ws.workspaceId, transactionId], enabled: !!transactionId, queryFn: () => withdrawalsUsedBy(database, ws, transactionId!) });
}
