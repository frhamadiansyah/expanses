import { setAccountNumberLast4 } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { useAccountNumberLast4 } from '../cards/card-queries';
import { readAccountNumberLast4 } from './wallet-last4';

/**
 * A bank account's number, by its last four digits, on its settings: what its alerts name it by ("rek ****1234") and its
 * rows show as "···· 1234". The row saves when it is left, as the page's other rows do; emptied, it removes them.
 */
export function BankNumberGroup({ accountId }: { accountId: string }) {
  const digits = useAccountNumberLast4();
  if (!digits.data) return null;
  // Keyed by what is saved, so a save made elsewhere starts the field afresh rather than under a stale value.
  const saved = digits.data[accountId] ?? null;
  return <BankNumberRow key={`${accountId}-${saved ?? ''}`} accountId={accountId} saved={saved} />;
}

function BankNumberRow({ accountId, saved }: { accountId: string; saved: string | null }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [typed, setTyped] = useState(saved ?? '');
  const [error, setError] = useState<unknown>(null);
  const read = readAccountNumberLast4(typed);

  async function save() {
    setError(null);
    if (!read.ok || read.last4 === saved) return;
    try {
      await setAccountNumberLast4(database, ws, accountId, read.last4);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <InsetGroup header="Account number" footer="Shown on this account's transactions, and how bank alerts that name it are filed here.">
        <TextRow
          label="Last 4 digits of account number"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => void save()}
          inputMode="numeric"
          placeholder="None"
          className="tabular"
          hint={read.ok ? undefined : read.error}
        />
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
