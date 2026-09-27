import { type DebtDirection, isoDate, minorToMajorString, parseMajor } from '@expanses/core';
import { editLoanEntry, type LoanEntry } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratesForSave } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
import { CategoryOptions } from '../cards/options';
import { loanMoneyAccounts } from './debts-form';
import { loanFigureLabels } from './lend-borrow-view';

/**
 * The money lent or borrowed, opened from a loan's History to be changed: the amount, the account it moved through,
 * the day and any fee — the rows of New receivable that belong to the money. Saving replaces the entry, so every
 * balance and the fee's spending follow; a loan made smaller than what has already come back is refused in words.
 *
 * It has no delete of its own: without it there is no loan, and removing that is Delete loan behind ⋯.
 */
export function LentEntrySheet({
  entry,
  direction,
  currency,
  onDone,
}: {
  entry: LoanEntry;
  direction: DebtDirection;
  currency: string;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  // The loan is kept in its own currency, so only accounts in that currency can carry it.
  const money = loanMoneyAccounts(
    moneyHolders(accounts).filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.currency === currency),
    direction,
  );
  const [amount, setAmount] = useState(() => minorToMajorString(entry.amountMinor, currency));
  const [moneyId, setMoneyId] = useState(entry.moneyAccountId);
  const [occurredOn, setOccurredOn] = useState(entry.occurredOn);
  const [fee, setFee] = useState(() => (entry.feeMinor > 0 ? minorToMajorString(entry.feeMinor, currency) : ''));
  const feesCategoryId = accounts.find((account) => account.kind === 'expense' && account.systemKey === 'miscellaneous.fees_charges')?.id ?? '';
  const [feeCategoryId, setFeeCategoryId] = useState(entry.feeCategoryId ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const labels = loanFigureLabels(direction);
  const hasFee = fee.trim() !== '' && fee.trim() !== '0';

  async function save() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      let amountMinor: number;
      let feeMinor = 0;
      try {
        amountMinor = parseMajor(amount, currency);
        feeMinor = hasFee ? parseMajor(fee, currency) : 0;
      } catch {
        throw new Error('The amount must be a number');
      }
      if (!(amountMinor > 0)) throw new Error(`Enter the ${labels.given.toLowerCase()}`);
      const ratesToBase = await ratesForSave({ database, ws, currency, occurredOn, amountMinor, typed: '', resolveRates, onMissing: () => {} });
      await editLoanEntry(database, ws, entry.transactionId, {
        occurredOn,
        amountMinor,
        moneyAccountId: moneyId,
        feeMinor,
        feeCategoryId: feeMinor > 0 ? feeCategoryId || feesCategoryId : null,
        ratesToBase,
      });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      grouped
      title={direction === 'lent' ? 'Lent' : 'Borrowed'}
      onClose={onDone}
      confirm={{ label: 'Save', disabled: busy || amount.trim() === '' || !moneyId, run: () => void save() }}
    >
      <InsetGroup>
        <TextRow label={`${labels.given} (${currency})`} value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
        <SelectRow label={direction === 'lent' ? 'Paid from' : 'Received into'} value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
          {money.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
        <TextRow label={`Fee (${currency})`} value={fee} inputMode="decimal" onChange={(e) => setFee(e.target.value)} placeholder="Amount" />
        {hasFee ? (
          <SelectRow label="Fee category" value={feeCategoryId || feesCategoryId} onChange={(e) => setFeeCategoryId(e.target.value)}>
            <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
          </SelectRow>
        ) : null}
      </InsetGroup>
      <ErrorBox error={error} />
    </Sheet>
  );
}
