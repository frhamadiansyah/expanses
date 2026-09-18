import { cashItem, CURRENCIES, isoDate, type MoneyAccountSubtype, parseMajor, parseRate } from '@expanses/core';
import { openCashAccount, upsertRate } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll, useResolveRates } from '../../lib/queries';
import { checkManualRate, ratePreview } from '../../lib/rates';
import { Button, ErrorBox, InputRow, RowGroup, RowHint, SelectRow } from '../../ui';
import { fieldsFor } from './catalogue-view';

/**
 * The form that follows a choice on the account picker.
 *
 * It asks only what its item needs: a wallet is a name and a balance, an account at a bank adds which bank and
 * which currency, and a time deposit adds the day the money comes back and what it pays. The catalogue decided
 * all of that when the item was chosen — this form only draws it.
 *
 * The bank is kept as the Coretax "Nama bank/institusi" of the account's own kas row, which is where the tax
 * report reads it from; there is no column on `accounts` for it, and inventing one would break older databases.
 */
export function CashAccountForm({ item }: { item: MoneyAccountSubtype }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [bank, setBank] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [maturesOn, setMaturesOn] = useState('');
  const [rate, setRate] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [manualRate, setManualRate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // A row is one line and has no room to explain itself, so the sentence lives under the group and the row points at it.
  const balanceHint = useId();

  const chosen = cashItem(item);
  const asks = fieldsFor('account', item);
  const locked = asks.includes('matures');
  const foreign = currency !== ws.baseCurrency;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, currency) : 0;
      let openingRateToBase: number | undefined;
      if (foreign && openingBalanceMinor !== 0) {
        if (manualRate.trim()) {
          openingRateToBase = parseRate(manualRate);
          await checkManualRate(database, currency, ws.baseCurrency, openedOn, openingRateToBase);
          await upsertRate(database, { fromCurrency: currency, toCurrency: ws.baseCurrency, onDate: openedOn, rate: openingRateToBase, source: 'manual', sourceDate: openedOn });
        } else {
          const resolved = await resolveRates([currency], openedOn);
          openingRateToBase = resolved.rates[currency];
          if (openingRateToBase === undefined) throw new Error(`No ${currency}→${ws.baseCurrency} rate available. Enter it manually.`);
        }
      }
      await openCashAccount(database, ws, {
        item,
        name,
        currency,
        openingBalanceMinor,
        openedOn,
        openingRateToBase,
        bank: bank.trim() || undefined,
        maturesOn: locked ? maturesOn : undefined,
        // A rate is stored in basis points, so 6,25% is 625 and nothing is lost to a fraction of a percent.
        rateBps: locked && rate.trim() ? Math.round(parseRate(rate) * 100) : undefined,
      });
      await invalidate();
      await navigate({ to: '/accounts' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <RowHint>
        {chosen.label} · {chosen.sub}
        {locked && ' · cannot be spent from directly'}
      </RowHint>
      <ErrorBox error={error} />
      <RowGroup>
        <InputRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA Tahapan" required />
        {asks.includes('balance') && (
          <InputRow
            label="Balance now"
            aria-describedby={balanceHint}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
        {asks.includes('bank') && <InputRow label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="BCA" />}
        {asks.includes('currency') && (
          <SelectRow label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </SelectRow>
        )}
        {asks.includes('matures') && <InputRow label="Matures on" type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)} required />}
        {asks.includes('rate') && <InputRow label="Interest rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="6,25" />}
        <InputRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        {foreign && <InputRow label={`Rate: ${ws.baseCurrency} per 1 ${currency}`} value={manualRate} onChange={(e) => setManualRate(e.target.value)} inputMode="decimal" />}
      </RowGroup>
      {asks.includes('balance') && <RowHint id={balanceHint}>Optional. Posted as an opening balance.</RowHint>}
      {foreign && <RowHint>{ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}</RowHint>}
      <RowHint>The picker chose what kind of account this is. Name is what you call yours.</RowHint>
      {locked && <RowHint>When it matures, move the money to an account with a transfer.</RowHint>}
      <Button type="submit" disabled={busy}>
        Add account
      </Button>
    </form>
  );
}
