import { isoDate, parseMajor } from '@expanses/core';
import { type AccountRow, type CardRow, moveMoneyIn } from '@expanses/db';
import { type FormEvent, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { canMoveMoneyIn } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { useCards } from '../cards/card-queries';
import { paymentKey, paymentOptions } from '../transactions/quick-row';

export type MoneyInMode = 'withdraw' | 'top-up';

/** What each one is called, and what its fee is called. */
export const MONEY_IN = {
  withdraw: { title: 'Cash withdrawal', fee: 'ATM fee', about: 'A transfer between your own accounts: not income, not spending. An ATM fee is spending.' },
  'top-up': { title: 'Top up', fee: 'Top-up fee', about: 'Your own money moving in: not income. Receive is for money someone else sends you. A fee is spending.' },
} as const;

/**
 * Money into cash from a bank (Withdraw), or into a wallet from a bank or a card (Top up), with what it cost to do.
 *
 * Its own form rather than the transfer's: a transfer has no fee, and a top-up may come from a credit card, which a
 * transfer never names. From offers what `canMoveMoneyIn` allows, in this account's currency, opening on the first
 * current account — the usual place a withdrawal or a top-up comes from.
 */
export function MoneyInForm({
  into,
  mode,
  formId,
  onCanSave,
  onDone,
}: {
  into: AccountRow;
  mode: MoneyInMode;
  formId: string;
  onCanSave: (canSave: boolean) => void;
  onDone: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts();
  const cards = useCards();
  const currency = into.currency!;
  const today = isoDate();
  const sources = moneyHolders(accounts.data ?? []).filter((a) => a.currency === currency && canMoveMoneyIn(a, into));
  const options = paymentOptions(sources, (cards.data ?? []) as CardRow[]);
  const held = options.filter((o) => sources.find((a) => a.id === o.accountId)?.kind === 'asset');
  const owed = options.filter((o) => sources.find((a) => a.id === o.accountId)?.kind === 'liability');
  const opening = options.find((o) => sources.find((a) => a.id === o.accountId)?.subtype === 'bank') ?? options[0];
  const [picked, setPicked] = useState<string | null>(null);
  const fromKey = picked ?? (opening ? paymentKey(opening.accountId, opening.cardId) : '');
  const from = options.find((o) => paymentKey(o.accountId, o.cardId) === fromKey);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const words = MONEY_IN[mode];
  const ready = Boolean(from) && amount.trim() !== '' && !busy;
  useEffect(() => onCanSave(ready), [onCanSave, ready]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !from) return;
    setError(null);
    setBusy(true);
    try {
      const amountMinor = parseMajor(amount, currency);
      const feeMinor = fee.trim() === '' ? 0 : parseMajor(fee, currency);
      let rateToBase: number | undefined;
      if (currency !== ws.baseCurrency) {
        rateToBase = (await resolveRates([currency], occurredOn)).rates[currency];
        if (rateToBase === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate for ${occurredOn} yet.`);
      }
      await moveMoneyIn(database, ws, {
        toId: into.id,
        fromId: from.accountId,
        cardId: from.cardId,
        amountMinor,
        feeMinor,
        occurredOn,
        description: words.title,
        feeDescription: words.fee,
        rateToBase,
      });
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const option = (o: (typeof options)[number]) => (
    <option key={paymentKey(o.accountId, o.cardId)} value={paymentKey(o.accountId, o.cardId)}>
      {/* The digits whenever they are known, as Paid with shows a card: "BCA Everyday ···· 1234". */}
      {o.last4 ? `${o.accountName} ···· ${o.last4}` : o.accountName}
    </option>
  );
  return (
    <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
      <ErrorBox error={error ?? accounts.error ?? cards.error} />
      <InsetGroup className="!mb-0">
        <SelectRow label="From" value={fromKey} onChange={(e) => setPicked(e.target.value)}>
          {options.length === 0 && <option value="">{`Nothing else holds ${currency}`}</option>}
          {/* An array, not a fragment: the row finds the chosen option's name by walking its children. */}
          {owed.length > 0
            ? [
                <optgroup key="held" label="Accounts">
                  {held.map(option)}
                </optgroup>,
                <optgroup key="owed" label="Credit cards">
                  {owed.map(option)}
                </optgroup>,
              ]
            : held.map(option)}
        </SelectRow>
        <ReadOnlyRow label="Into" value={into.name} />
        <TextRow label="Amount" info={words.about} inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <TextRow label={words.fee} inputMode="decimal" placeholder="Optional" value={fee} onChange={(e) => setFee(e.target.value)} />
        <TextRow label="Date" type="date" value={occurredOn} max={today} onChange={(e) => setOccurredOn(e.target.value)} />
      </InsetGroup>
    </form>
  );
}
