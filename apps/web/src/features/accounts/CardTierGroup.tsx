import { type AccountRow, setAccountCardTier } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow } from '../../ui/native';
import { useCardTiers } from '../cards/card-queries';
import { faceFor, type FaceTier } from '../cards/debit-art/faces';
import { useAssetProfiles } from '../networth/queries';
import { bankOf } from '../wallet/wallet-model';

/**
 * Which of its bank's debit cards a bank account is drawn as in Wallet, on its settings — only for a bank whose cards
 * come in tiers that look nothing alike (Mandiri, BCA, BSI, CIMB). The bank is read the way Wallet reads it, off the
 * account's tax-report institution or its name; an account at any other bank has no row. Saves as it is chosen, as
 * every row on the page does; the first tier is the default and is kept as nothing chosen.
 */
export function CardTierGroup({ account }: { account: Pick<AccountRow, 'id' | 'name'> }) {
  const accounts = useAccounts();
  const profiles = useAssetProfiles();
  const tiers = useCardTiers();
  if (!accounts.data || !profiles.data || !tiers.data) return null;
  const face = faceFor([bankOf(account.id, accounts.data, profiles.data), account.name], ['debit']);
  if (!face?.tiers) return null;
  const saved = tiers.data[account.id] ?? null;
  return <CardTierRow key={`${account.id}-${saved ?? ''}`} accountId={account.id} tiers={face.tiers} saved={saved} />;
}

function CardTierRow({ accountId, tiers, saved }: { accountId: string; tiers: readonly FaceTier[]; saved: string | null }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const first = tiers[0]!;
  const chosen = tiers.some((tier) => tier.id === saved) ? saved! : first.id;

  async function save(id: string) {
    setError(null);
    try {
      await setAccountCardTier(database, ws, accountId, id === first.id ? null : id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <InsetGroup header="Debit card" footer="Which of the bank's cards is drawn for this account in Wallet.">
        <SelectRow label="Card tier" value={chosen} onChange={(e) => void save(e.target.value)}>
          {tiers.map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.label}
            </option>
          ))}
        </SelectRow>
      </InsetGroup>
      <ErrorBox error={error} />
    </>
  );
}
