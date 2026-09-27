import { type DebtDirection, isoDate, minorToMajorString } from '@expanses/core';
import { deleteLoanEntry, editLoanEntry, type LoanEntry, recordRepayment } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useHeldRates } from '../accounts/queries';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { repaymentWord } from './lend-borrow-view';
import { emptyRepaymentDraft, type RepaymentDraft, repaymentDraftToInput } from './debts-form';

/**
 * Money coming back on one loan, or going back on one: the amount, any interest, the day and the account.
 *
 * It rises as a sheet over the loan's page, so the page under it never jumps and the loan stays in sight; the
 * sheet's corner, its backdrop and Escape all close it without saving. Paying back money you borrowed takes it out of an account — the amount and any interest — so it asks
 * the set-aside question; money coming back brings money in and asks nothing. A loan in another currency is repaid
 * at the day's rate, asked for when none is stored, as lending does.
 */
export function RepaymentForm({
  debtAccountId,
  direction,
  currency,
  personName,
  balanceMinor,
  entry,
  onDone,
}: {
  debtAccountId: string;
  direction: DebtDirection;
  currency: string;
  personName: string;
  /** What is owed now. When `entry` is being changed, the amount it took off is added back before checking. */
  balanceMinor: number;
  /** A collection or repayment already recorded, opened from History to be changed or taken off. */
  entry?: LoanEntry;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  // Somewhere money can actually sit: never another person's account.
  const moneyAccounts = moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype));
  const today = isoDate();
  const [draft, setDraft] = useState<RepaymentDraft>(() =>
    entry
      ? {
          amount: minorToMajorString(entry.amountMinor, currency),
          interest: entry.interestMinor > 0 ? minorToMajorString(entry.interestMinor, currency) : '',
          occurredOn: entry.occurredOn,
          moneyId: entry.moneyAccountId,
        }
      : emptyRepaymentDraft(today, moneyAccounts[0]?.id ?? ''),
  );
  // Changing an entry, what it took off the loan is owed again until the new figure is saved.
  const owedBefore = entry ? balanceMinor + entry.amountMinor : balanceMinor;
  const word = repaymentWord(direction);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [manualRate, setManualRate] = useState('');
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const foreign = currency !== ws.baseCurrency;
  const held = useHeldRates(foreign ? [currency] : [], draft.occurredOn > today ? today : draft.occurredOn);
  const asksRate = foreign && (needsRate === currency || (held.data?.missing ?? []).includes(currency));
  const moneyId = draft.moneyId || moneyAccounts[0]?.id || '';
  const set = (patch: Partial<RepaymentDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const outflowMinor = (() => {
    if (direction !== 'borrowed') return 0;
    try {
      const input = repaymentDraftToInput({ ...draft, moneyId }, debtAccountId, currency, owedBefore, personName);
      return input.amountMinor + (input.interestMinor ?? 0);
    } catch {
      return 0;
    }
  })();
  // Only a new payment asks about money set aside; a correction to one already made does not ask again.
  const setAside = useSetAside(direction === 'borrowed' && !entry ? spendingDoor(moneyId, outflowMinor) : null);
  // The ✓ is dim until there is an amount; anything else wrong with it is said in words when ✓ is pressed, since a
  // dim ✓ alone could not say that Andi owes less than was typed.
  const ready = draft.amount.trim() !== '';

  async function save() {
    if (!setAside.ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const input = repaymentDraftToInput({ ...draft, moneyId }, debtAccountId, currency, owedBefore, personName);
      const ratesToBase = await ratesForSave({
        database,
        ws,
        currency,
        occurredOn: input.occurredOn,
        amountMinor: input.amountMinor,
        typed: asksRate ? manualRate : '',
        resolveRates,
        onMissing: setNeedsRate,
      });
      if (entry) {
        await editLoanEntry(database, ws, entry.transactionId, {
          occurredOn: input.occurredOn,
          amountMinor: input.amountMinor,
          interestMinor: input.interestMinor ?? 0,
          moneyAccountId: input.moneyAccountId,
          ratesToBase,
        });
      } else {
        await recordRepayment(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Takes this one off the loan; what it paid is owed again, and the loan stays. */
  async function remove() {
    if (!entry || busy) return;
    if (!window.confirm(`Delete this ${word.toLowerCase()}? What it paid is owed again.`)) return;
    setError(null);
    setBusy(true);
    try {
      await deleteLoanEntry(database, ws, entry.transactionId);
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={word} onClose={onDone} confirm={{ label: `Save ${word.toLowerCase()}`, disabled: busy || !setAside.ready || !ready, run: () => void save() }}>
      <InsetGroup>
        <TextRow
          label={`${direction === 'lent' ? 'Came back' : 'Paid back'} (${currency})`}
          value={draft.amount}
          inputMode="decimal"
          onChange={(e) => set({ amount: e.target.value })}
          placeholder="Amount"
        />
        <TextRow
          label={`Interest (${currency})`}
          info="Optional. Interest is income on money lent and spending on money borrowed; the loan itself is neither."
          value={draft.interest}
          inputMode="decimal"
          onChange={(e) => set({ interest: e.target.value })}
          placeholder="0"
        />
        <TextRow label="Date" type="date" value={draft.occurredOn} max={today} onChange={(e) => set({ occurredOn: e.target.value })} />
        <SelectRow label={direction === 'lent' ? 'Into' : 'From'} value={draft.moneyId} onChange={(e) => set({ moneyId: e.target.value })}>
          {moneyAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        {asksRate ? (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'No rate is stored for this day. Leave empty to fetch it.'}
            value={manualRate}
            inputMode="decimal"
            onChange={(e) => setManualRate(e.target.value)}
            placeholder="16250"
          />
        ) : null}
      </InsetGroup>
      {setAside.node}
      <ErrorBox error={error} />
      {entry ? (
        <InsetGroup>
          <InsetRow title={`Delete this ${word.toLowerCase()}`} destructive onClick={() => void remove()} />
        </InsetGroup>
      ) : null}
    </Sheet>
  );
}
