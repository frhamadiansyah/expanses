import { dayMonth, formatMinor } from '@expanses/core';
import { feeWaivedStatus, type FeeWaivedStatus } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/** What a waived fee's challenge says: "✓ Fee waived · Rp 1.200.000 back on 14 Nov", or "✓ Fee waived" with nothing back. */
export function waivedLine(status: FeeWaivedStatus, currency: string): string {
  return status.back ? `✓ Fee waived · ${formatMinor(status.back.amountMinor, currency)} back on ${dayMonth(status.back.on)}` : '✓ Fee waived';
}

/** How this year's fee stands on the card: waived or not, what came back, and the year the card's challenge is for. */
export function useFeeWaivedStatus(cardId: string, today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['fee-waived-status', ws.workspaceId, cardId, today], queryFn: () => feeWaivedStatus(database.db, ws, { cardId, today }) });
}
