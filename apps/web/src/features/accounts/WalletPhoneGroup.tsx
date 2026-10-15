import { setWalletLast4 } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { useWalletLast4 } from '../cards/card-queries';
import { readWalletLast4 } from './wallet-last4';

/**
 * A digital wallet's phone number, by its last four digits, on its settings: what its rows show as "···· 5521", the way
 * a card's show its own. The row saves when it is left, as the page's other rows do; emptied, it removes them.
 */
export function WalletPhoneGroup({ accountId }: { accountId: string }) {
  const digits = useWalletLast4();
  if (!digits.data) return null;
  // Keyed by what is saved, so a save made elsewhere starts the field afresh rather than under a stale value.
  const saved = digits.data[accountId] ?? null;
  return <WalletPhoneRow key={`${accountId}-${saved ?? ''}`} accountId={accountId} saved={saved} />;
}

function WalletPhoneRow({ accountId, saved }: { accountId: string; saved: string | null }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState(saved ?? '');
  const [error, setError] = useState<unknown>(null);
  const read = readWalletLast4(typed);

  async function save() {
    setError(null);
    if (!read.ok || read.last4 === saved) return;
    try {
      await setWalletLast4(database, ws, accountId, read.last4);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <InsetGroup header="Phone" footer="Shown on this wallet's transactions, as a card's last 4 digits are.">
        <TextRow
          label="Last 4 digits of phone"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => void save()}
          inputMode="numeric"
          maxLength={4}
          placeholder="None"
          className="tabular"
          hint={read.ok ? undefined : read.error}
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
