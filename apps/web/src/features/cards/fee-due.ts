import { type UpcomingFee, upcomingFees } from '@expanses/core';
import { listCardTerms } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';

export interface DueFee {
  cardId: string;
  name: string;
  currency: string;
  annualFeeMinor: number | null;
  annualFeeOn: string | null;
  annualFeeWaivedYear: number | null;
}

/** The cards whose annual fee is charged within the next 30 days, soonest first, for Recurring's Due soon. */
export function useUpcomingFees(today: string): UpcomingFee<DueFee>[] {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms-all', ws.workspaceId], queryFn: () => listCardTerms(database, ws) });
  const cards: DueFee[] = (terms.data ?? []).flatMap((t) => {
    const account = (accounts.data ?? []).find((a) => a.id === t.accountId);
    return account && !account.archivedAt
      ? [{ cardId: t.accountId, name: account.name, currency: account.currency ?? ws.baseCurrency, annualFeeMinor: t.annualFeeMinor, annualFeeOn: t.annualFeeOn, annualFeeWaivedYear: t.annualFeeWaivedYear }]
      : [];
  });
  return upcomingFees(cards, today);
}
