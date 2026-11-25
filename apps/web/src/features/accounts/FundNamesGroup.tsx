import { bankMatches, brokerMatches } from '@expanses/core';
import { renameAccount, setPocketedIdentity } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { typedNameOf } from '../../lib/account-name';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { InsetGroup } from '../../ui/native';
import { errorHint } from '../networth/AssetSettings';
import { useAssetProfile, useAssetProfiles } from '../networth/queries';
import { SuggestRow } from '../ownables/CashAccountForm';
import { bankOf } from '../wallet/wallet-model';
import { fundNamesFooter } from './fund-names';
import { setKasField } from './kas-fields';

/**
 * A Fund account's two names, at the top of its Settings (owner, 25 Nov): its Broker — the account's own name, what its
 * stocks and funds are kept at — and its Custodian bank, the tax report's Nama institusi, where the money sits. They
 * stand for the Name and the "Bank or institution" every other money account has; each saves when it is left or an
 * offered name is picked, and the sentence under them says which name each place shows.
 */
export function FundNamesGroup({ accountId }: { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const profile = useAssetProfile(accountId);
  const profiles = useAssetProfiles();
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  // An account with pockets keeps its bank on them, as a bank account with pockets does.
  const pocketed = (accounts.data ?? []).some((row) => row.parentId === accountId);
  const savedBank = pocketed ? (bankOf(accountId, accounts.data ?? [], profiles.data ?? []) ?? '') : (profile.data?.coretaxFields.inst ?? '');
  const [broker, setBroker] = useState<string | null>(null);
  const [bank, setBank] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ broker?: unknown; bank?: unknown }>({});
  if (!account) return null;
  const shownBroker = broker ?? typedNameOf(account);
  const shownBank = bank ?? savedBank;
  const offersNames = ws.baseCurrency === 'IDR';

  const saveBroker = (next: string) =>
    void (async () => {
      setErrors((was) => ({ ...was, broker: null }));
      try {
        const name = next.trim();
        if (name !== '' && name !== typedNameOf(account)) await renameAccount(database, ws, accountId, name);
        await invalidate();
        setBroker(null);
      } catch (e) {
        setErrors((was) => ({ ...was, broker: e }));
      }
    })();
  const saveBank = (next: string) =>
    void (async () => {
      setErrors((was) => ({ ...was, bank: null }));
      try {
        if (next.trim() !== savedBank.trim()) {
          if (pocketed) await setPocketedIdentity(database, ws, accountId, { inst: next.trim() });
          else await setKasField(database, ws, account, 'inst', next);
        }
        await invalidate();
        setBank(null);
      } catch (e) {
        setErrors((was) => ({ ...was, bank: e }));
      }
    })();

  const error = errors.broker ?? errors.bank;
  return (
    <>
    {error ? <div className="px-4 pb-2 text-[13px]">{errorHint(error)}</div> : null}
    <InsetGroup footer={fundNamesFooter(shownBroker, shownBank)}>
      <SuggestRow
        label="Broker"
        stripLabel="Brokers"
        info="Where the stocks and funds are kept. Stocks, funds and their tax lines are named by it."
        value={shownBroker}
        onChange={setBroker}
        onCommit={saveBroker}
        placeholder="Securities firm"
        offers={(typed) => (offersNames ? brokerMatches(typed) : [])}
      />
      <SuggestRow
        label="Custodian bank"
        stripLabel="Banks"
        info="The bank holding this account's cash. In Indonesia, the RDN bank (Rekening Dana Nasabah). Money lists show the account by it."
        value={shownBank}
        onChange={setBank}
        onCommit={saveBank}
        placeholder="Bank"
        offers={(typed) => (offersNames ? bankMatches(typed) : [])}
      />
    </InsetGroup>
    </>
  );
}
