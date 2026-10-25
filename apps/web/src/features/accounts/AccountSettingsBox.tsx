import { type AccountRow, setAccountCardTier, setAccountForSpending, setAccountNumberLast4, setWalletLast4 } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { keptForSpending, SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { errorHint } from '../networth/AssetSettings';
import { useAssetProfiles } from '../networth/queries';
import { useAccountNumberLast4, useCardTiers, useProgramByAccount, useWalletLast4 } from '../cards/card-queries';
import { faceFor } from '../cards/debit-art/faces';
import { bankOf } from '../wallet/wallet-model';
import { spendsFrom } from './pockets';
import { last4Field, readAccountNumberLast4, readWalletLast4 } from './wallet-last4';

/**
 * What a money account is, in one box on its settings: whether it is for spending, its last four digits (a bank
 * account's number, a wallet's phone), which of its bank's debit cards it is drawn as, and its debit card's rewards.
 * Each row saves as it is changed or left, as the page's other rows do, and a row that does not apply to this account
 * is not there. Under the rows there is no sentence: what each does is read from its name.
 */
export function AccountSettingsBox({ account, onError }: { account: AccountRow; onError: (error: unknown) => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const profiles = useAssetProfiles();
  const bankDigits = useAccountNumberLast4();
  const phoneDigits = useWalletLast4();
  const tiers = useCardTiers();
  const programs = useProgramByAccount();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const all = accounts.data ?? [];
  const bank = account.subtype === 'bank' || account.subtype === 'savings';
  const wallet = account.subtype === 'ewallet';
  const parent = (account.parentId ? all.find((row) => row.id === account.parentId) : undefined) ?? null;

  const run = (write: () => Promise<void>) =>
    void (async () => {
      onError(null);
      try {
        await write();
        await invalidate();
      } catch (e) {
        onError(e);
      }
    })();

  /** A last-4 row: saved when left; fewer than four digits is said under it and not saved. */
  const digitsRow = (saved: string | null, read: typeof readAccountNumberLast4, write: (last4: string | null) => Promise<void>) => {
    const shown = typed.digits ?? saved ?? '';
    const reading = read(shown);
    return (
      <TextRow
        key={`digits-${saved ?? ''}`}
        label="Last 4 digits"
        value={shown}
        {...last4Field((digits) => {
          setTyped({ digits });
          setProblem(null);
        })}
        onBlur={() => {
          if (!reading.ok) return setProblem(reading.error);
          if (reading.last4 === saved) return;
          run(() => write(reading.last4));
        }}
        placeholder="None"
        className="tabular"
        hint={problem ? errorHint(problem) : undefined}
      />
    );
  };

  const rows = [];
  if (account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype)) {
    rows.push(
      <SwitchRow
        key="spending"
        label="For spending"
        // As Wallet reads it: an account whose pockets are all switched off reads off (`spendsFrom`).
        checked={spendsFrom(account, all)}
        disabled={parent !== null && !keptForSpending(parent)}
        onChange={(on) => run(() => setAccountForSpending(database, ws, account.id, on))}
      />,
    );
  }
  if (bank && bankDigits.data) rows.push(digitsRow(bankDigits.data[account.id] ?? null, readAccountNumberLast4, (last4) => setAccountNumberLast4(database, ws, account.id, last4)));
  if (wallet && phoneDigits.data) rows.push(digitsRow(phoneDigits.data[account.id] ?? null, readWalletLast4, (last4) => setWalletLast4(database, ws, account.id, last4)));

  // Which of its bank's debit cards it is drawn as: only a bank whose cards come in tiers that look nothing alike.
  const face = bank && account.parentId === null && accounts.data && profiles.data ? faceFor([bankOf(account.id, accounts.data, profiles.data), account.name], ['debit']) : null;
  if (face?.tiers && tiers.data) {
    const first = face.tiers[0]!;
    const saved = tiers.data[account.id] ?? null;
    rows.push(
      <SelectRow
        key="tier"
        label="Card tier"
        value={face.tiers.some((tier) => tier.id === saved) ? saved! : first.id}
        onChange={(e) => run(() => setAccountCardTier(database, ws, account.id, e.target.value === first.id ? null : e.target.value))}
      >
        {face.tiers.map((tier) => (
          <option key={tier.id} value={tier.id}>
            {tier.label}
          </option>
        ))}
      </SelectRow>,
    );
  }

  // Whether its debit card earns rewards: the way to the card's page, where they are set up and kept.
  if (bank && account.parentId === null && programs.data) {
    const program = programs.data.get(account.id);
    rows.push(<InsetRow key="rewards" testId="debit-card-rewards" title="Debit card rewards" value={program ? program.name || 'Earning' : 'Not set up'} to="/cards/$cardId" params={{ cardId: account.id }} />);
  }

  return rows.length === 0 ? null : <InsetGroup>{rows}</InsetGroup>;
}
