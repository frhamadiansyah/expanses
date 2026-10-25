import { renameAccount } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { typedNameOf } from '../../lib/account-name';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import type { GroupChild } from '../../ui/native';
import { errorHint } from '../networth/AssetSettings';
import { useAssetProfile } from '../networth/queries';
import { BankNameRow } from '../ownables/CashAccountForm';
import { setKasField } from './kas-fields';

/**
 * A bank account's name on its Settings, as Add account asked for it: its bank, then › and the name typed, in the one
 * row, so what is edited is plain. The bank is the tax report's Nama institusi, kept in the same place, so the tax
 * report does not ask for it again. Saved when focus leaves the row: a name emptied is not taken.
 */
export function SettingsNameRow({ accountId, position }: GroupChild & { accountId: string }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const profile = useAssetProfile(accountId);
  const account = (accounts.data ?? []).find((row) => row.id === accountId);
  const savedBank = profile.data?.coretaxFields.inst ?? '';
  const [bank, setBank] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!account) return null;
  const shownBank = bank ?? savedBank;
  const shownName = name ?? typedNameOf(account);

  const save = () =>
    void (async () => {
      setError(null);
      try {
        const nextName = shownName.trim();
        if (nextName !== '' && nextName !== typedNameOf(account)) await renameAccount(database, ws, accountId, nextName);
        await setKasField(database, ws, account, 'inst', shownBank);
        await invalidate();
        setBank(null);
        setName(null);
      } catch (e) {
        setError(e);
      }
    })();

  return (
    <div
      // Enter finishes the half being typed in, as it does in every other row here.
      onKeyDown={(e) => e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.blur()}
      onBlur={(e) => {
        // Focus moving between the two halves is not leaving the row.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
      }}
    >
      <BankNameRow bank={shownBank} onBank={setBank} name={shownName} onName={setName} offersBanks={ws.baseCurrency === 'IDR'} position={position} />
      {error ? <div className="px-4 pb-2 text-[13px]">{errorHint(error)}</div> : null}
    </div>
  );
}
