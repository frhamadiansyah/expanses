import { type AccountRow, changeOpeningDate, setAccountCardTier, setAccountForSpending, setCountedFrom, setAccountNumberLast4, setWalletLast4 } from '@expanses/db';
import { CATALOG } from '@expanses/catalog';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { keptForSpending, SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { formatMinor, isoDate } from '@expanses/core';
import { InsetGroup, PickerRow, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useCountedFrom, useOpenings } from './queries';
import { errorHint } from '../networth/AssetSettings';
import { useAssetProfile, useAssetProfiles } from '../networth/queries';
import { useAccountNumberLast4, useCardTiers, useProgramByAccount, useWalletLast4 } from '../cards/card-queries';
import { CardRewardsSheet } from '../cards/CardRewardsSheet';
import { rewardsLabel } from '../cards/catalog-picker';
import { faceFor } from '../cards/debit-art/faces';
import { bankOf } from '../wallet/wallet-model';
import { setKasField } from './kas-fields';
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
  const profile = useAssetProfile(account.id);
  const bankDigits = useAccountNumberLast4();
  const phoneDigits = useWalletLast4();
  const tiers = useCardTiers();
  const programs = useProgramByAccount();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const openings = useOpenings([account.id]);
  const opening = openings.data?.[account.id];
  const countedFrom = useCountedFrom();

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

  /**
   * A bank account's number, as much of it as is typed: the whole number goes to the tax report's Nomor Akun, and its
   * last four digits to the rows and alerts. Only four typed is kept as four, and emptied removes both.
   */
  const numberRow = (saved: string | null, whole: string) => {
    const shown = typed.number ?? (whole || saved || '');
    const reading = readAccountNumberLast4(shown);
    return (
      <TextRow
        key={`number-${saved ?? ''}-${whole}`}
        label="Account number"
        info="Optional. The last 4 digits are enough to tell accounts apart and to file bank alerts under this one; the full number is only needed for the tax report."
        value={shown}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => {
          setTyped({ number: e.target.value.replace(/[^\d\s-]/g, '') });
          setProblem(null);
        }}
        onBlur={() => {
          if (!reading.ok) return setProblem(reading.error);
          const next = shown.trim();
          if (reading.last4 === saved && next === (whole || saved || '')) return;
          run(async () => {
            await setAccountNumberLast4(database, ws, account.id, reading.last4);
            // Written over what is saved now, as the tax report's own rows are; an account with no profile gets one.
            await setKasField(database, ws, account, 'acct', next);
          });
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
  if (bank && bankDigits.data && !profile.isPending) rows.push(numberRow(bankDigits.data[account.id] ?? null, profile.data?.coretaxFields.acct ?? ''));
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

  // Whether its debit card earns rewards: a sheet to pick the card from the catalogue, with the way to its page inside.
  if (bank && account.parentId === null && programs.data) {
    const program = programs.data.get(account.id);
    rows.push(<PickerRow key="rewards" label="Card rewards" value={rewardsLabel(program, CATALOG)} onOpen={() => setRewardsOpen(true)} />);
  }

  // The day the balance is counted from. Only the default for new purchases: one dated before it starts out past.
  // One opened with money has its day on the opening entry; one opened at nothing has none, so it keeps a day of its
  // own (the day it was added until another is chosen) and the balance read there is nothing.
  const money = account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype) && account.currency;
  const zero = money && !opening && openings.isSuccess && countedFrom.isSuccess && account.createdAt;
  const asOf =
    money && opening
      ? { amountMinor: opening.amountMinor, currency: opening.currency, occurredOn: opening.occurredOn, stored: false }
      : zero
        ? { amountMinor: 0, currency: account.currency!, occurredOn: countedFrom.data![account.id] ?? account.createdAt.slice(0, 10), stored: true }
        : null;
  if (rows.length === 0 && !asOf) return null;
  return (
    <>
      {asOf && (
        <InsetGroup>
          <ReadOnlyRow label="Balance" value={formatMinor(asOf.amountMinor, asOf.currency)} />
          <TextRow
            key={`asof-${asOf.occurredOn}`}
            label="As of"
            type="date"
            value={asOf.occurredOn}
            max={isoDate()}
            onChange={(e) => {
              const on = e.target.value;
              if (!on || on === asOf.occurredOn) return;
              run(() => (asOf.stored ? setCountedFrom(database, ws, account.id, on, isoDate()) : changeOpeningDate(database, ws, account.id, on, isoDate())));
            }}
          />
        </InsetGroup>
      )}
      {rows.length > 0 && <InsetGroup>{rows}</InsetGroup>}
      {rewardsOpen && (
        <CardRewardsSheet account={account} program={programs.data?.get(account.id)} onDone={invalidate} onClose={() => setRewardsOpen(false)} onError={onError} />
      )}
    </>
  );
}
