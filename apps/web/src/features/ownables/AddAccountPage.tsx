import type { MoneyAccountSubtype } from '@expanses/core';
import { useRouter, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { noteAddedAccount } from '../transactions/draft-handoff';
import { CashAccountForm } from './CashAccountForm';
import { handOverRows } from './catalogue-view';
import { OwnablePicker } from './OwnablePicker';

/**
 * Adding an account, one family deep: only money belongs on the Accounts page, so there is no family level to
 * climb — the seven kinds of money account are the list.
 *
 * The two rows at the foot are the whole reason someone does not get stuck here: most people's first instinct
 * is that a house or a credit card is "an account", and the screen says plainly where each one goes instead.
 */
export function AddAccountPage() {
  const [chosen, setChosen] = useState<string | null>(null);
  const { returnTo } = useSearch({ from: '/accounts/new' });
  const router = useRouter();
  // From New transaction: the account made is noted for Paid with, and back is the way to the form set aside.
  const onCreated =
    returnTo === 'transaction'
      ? (accountId: string) => {
          noteAddedAccount(accountId);
          router.history.back();
        }
      : undefined;
  return (
    <OwnablePicker
      flow="account"
      title="New account"
      searchPlaceholder="Search"
      chosen={chosen}
      onChoose={setChosen}
      handOver={handOverRows('account')}
      backLabel={returnTo === 'transaction' ? 'New transaction' : undefined}
    >
      {chosen && <CashAccountForm key={chosen} item={chosen as MoneyAccountSubtype} onCreated={onCreated} />}
    </OwnablePicker>
  );
}
