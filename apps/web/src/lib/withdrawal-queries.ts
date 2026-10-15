import { foreignLots, foreignMovements, previewForeignCost, withdrawalsUsedBy } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApp } from '../app/context';

/*
 * The withdrawal rate's reads (spec §7). Every write ends in `useInvalidateAll`, which invalidates every query, so these
 * keys need no list of their own to be refreshed by.
 */

/**
 * What spending `amountMinor` from a foreign account would cost, before Save (R20). Idle until there is an amount. The
 * account's history is one query, keyed without the amount or the date (final review M5): it is read once and every
 * keystroke is priced from it in memory.
 */
export function useForeignCostPreview(input: { accountId: string; amountMinor: number | null; occurredOn: string; excludeTransactionId?: string | null; dayRate?: number | null }) {
  const { database, ws } = useApp();
  const enabled = !!input.accountId && input.amountMinor !== null && input.amountMinor > 0;
  const exclude = input.excludeTransactionId ?? null;
  const history = useQuery({
    queryKey: ['fx-movements', ws.workspaceId, input.accountId, exclude],
    enabled,
    queryFn: () => foreignMovements(database, ws, { accountId: input.accountId, excludeTransactionId: exclude }),
  });
  const data = useMemo(() => {
    if (!enabled || history.data === undefined) return undefined;
    if (history.data === null || history.data.accountId !== input.accountId) return null;
    return previewForeignCost(history.data, ws.baseCurrency, { amountMinor: input.amountMinor!, occurredOn: input.occurredOn, dayRate: input.dayRate ?? null });
  }, [enabled, history.data, input.accountId, input.amountMinor, input.occurredOn, input.dayRate, ws.baseCurrency]);
  return { data };
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
