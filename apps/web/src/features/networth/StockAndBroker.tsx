import { linkHolding } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { brokerChoices } from '../investments/add-holding';
import { useHoldingLinks, useSecurities } from '../investments/queries';

/** Which ticker a holding is and where it is kept (spec §7.6). */
export function StockAndBroker({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const link = (useHoldingLinks().data ?? []).find((l) => l.accountId === accountId);
  const security = (useSecurities().data ?? []).find((s) => s.id === link?.securityId);
  const accounts = useAccounts().data ?? [];
  const brokers = brokerChoices(accounts);
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

  return (
    <>
      <InsetGroup
        header="Stock and broker"
        footer={security ? `The price is ${security.ticker ?? security.name}’s, and values every broker that holds it.` : 'Give it a ticker so one price values it wherever it is kept.'}
      >
        <InsetRow title="Ticker" value={security ? (security.ticker ?? security.name) : 'Not set'} to="/net-worth/investments/new" search={{ link: accountId }} />
        <SelectRow label="Kept at" value={link?.brokerAccountId ?? ''} onChange={(e) => void keptAt(e.target.value)}>
          <option value="">No broker</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
