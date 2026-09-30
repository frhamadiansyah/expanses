import { linkHolding } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { brokerChoices } from '../investments/add-holding';
import { useHoldingLinks, useSecurities } from '../investments/queries';

/**
 * Which ticker a holding is and where it is kept (spec §7.6), for the rows of the asset page's Details: the security
 * it is linked to, the broker it sits at and the brokers it could, and the change of broker, saved as it is picked.
 */
export function useStockAndBroker(accountId: string) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const link = (useHoldingLinks().data ?? []).find((l) => l.accountId === accountId);
  const security = (useSecurities().data ?? []).find((s) => s.id === link?.securityId);
  const brokers = brokerChoices(useAccounts().data ?? []);
  const [error, setError] = useState<unknown>(null);

  async function keptAt(brokerAccountId: string) {
    setError(null);
    try {
      await linkHolding(database, ws, { accountId, brokerAccountId: brokerAccountId || null });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return { link, security, brokers, keptAt, error };
}
