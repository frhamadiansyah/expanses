import { type DebtDirection, isoDate } from '@expanses/core';
import { recordRepayment } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ratePreview, ratesForSave } from '../../lib/rates';
import { useHeldRates } from '../accounts/queries';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, SelectRow, TextRow } from '../../ui/native';
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
  onDone,
}: {
  debtAccountId: string;
  direction: DebtDirection;
  currency: string;
  personName: string;
  balanceMinor: number;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  // Somewhere money can actually sit: never another person's account.
  const moneyAccounts = moneyHolders(accounts).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype));
  const today = isoDate();
  const [draft, setDraft] = useState<RepaymentDraft>(() => emptyRepaymentDraft(today, moneyAccounts[0]?.id ?? ''));
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
      const input = repaymentDraftToInput({ ...draft, moneyId }, debtAccountId, currency, balanceMinor, personName);
      return input.amountMinor + (input.interestMinor ?? 0);
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(direction === 'borrowed' ? spendingDoor(moneyId, outflowMinor) : null);
  // The ✓ is dim until there is an amount; anything else wrong with it is said in words when ✓ is pressed, since a
  // dim ✓ alone could not say that Andi owes less than was typed.
  const ready = draft.amount.trim() !== '';

  async function save() {
    if (!setAside.ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const input = repaymentDraftToInput({ ...draft, moneyId }, debtAccountId, currency, balanceMinor, personName);
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
      await recordRepayment(database, ws, { ...input, ratesToBase, setAside: setAside.choice });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title={repaymentWord(direction)} onClose={onDone} confirm={{ label: `Save ${repaymentWord(direction).toLowerCase()}`, disabled: busy || !setAside.ready || !ready, run: () => void save() }}>
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
    </Sheet>
  );
}
