import { cashItem, CURRENCIES, isoDate, type MoneyAccountSubtype, parseMajor, parseRate } from '@expanses/core';
import { openCashAccount, openPocketedAccount } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { choosePocketCurrency, nextPocketCurrency, type PocketDraft, readPockets } from '../accounts/pockets';
import { fieldsFor } from './catalogue-view';

/**
 * The form that follows a choice on the account picker.
 *
 * It asks only what its item needs: a wallet is a name and a balance, an account at a bank adds which bank and
 * which currency, and a time deposit adds the day the money comes back and what it pays. The catalogue decided
 * all of that when the item was chosen — this form only draws it.
 *
 * A balance is the one answer with two meanings, so it asks which: money that was already there is an opening
 * balance against equity, and money out of an account the owner already tracks is a transfer that moves both
 * balances. The second is what someone opening a deposit usually means, and guessing it (or not offering it at
 * all) is how a ledger ends up with a transfer that names no source.
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
  const [sourceId, setSourceId] = useState('');
  const [maturesOn, setMaturesOn] = useState('');
  const [rate, setRate] = useState('');
  const [openedOn, setOpenedOn] = useState(isoDate());
  const [manualRate, setManualRate] = useState('');
  const [pocketed, setPocketed] = useState(false);
  const [pockets, setPockets] = useState<PocketDraft[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // A row is one line and has no room to explain itself, so the sentence lives under the group and the row points at it.
  const balanceHint = useId();
  const form = useRef<HTMLFormElement>(null);

  const chosen = cashItem(item);
  const asks = fieldsFor('account', item);
  const locked = asks.includes('matures');
  const foreign = currency !== ws.baseCurrency;
  // The kinds held at an institution, and not a deposit: its terms are per deposit (spec §16.3).
  const canPocket = asks.includes('bank') && !locked;
  const setPocket = (i: number, patch: Partial<PocketDraft>) => setPockets((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  // Where a typed balance could move from: accounts the owner can spend from, in the same currency, newest name order.
  const sources = (useAccounts().data ?? [])
    .filter((a) => !a.archivedAt && a.currency === currency && canPayWith(a))
    .sort((a, b) => a.name.localeCompare(b.name));
  const source = sources.find((a) => a.id === sourceId);
  // Read once, so the row that asks only when there is something to ask about never throws on half-typed money.
  const typedBalance = (() => {
    try {
      return balance.trim() ? parseMajor(balance, currency) : 0;
    } catch {
      return 0;
    }
  })();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (pocketed) {
        const read = readPockets(pockets);
        const settled = [];
        // Every rate is settled before any account is written, so the account and its pockets below are one
        // transaction: all or nothing. The rates are not part of it — a typed rate is stored as soon as it is
        // checked (`openingRateFor`), so a later pocket's refusal leaves an earlier typed rate saved for that day.
        for (const pocket of read) {
          settled.push({
            currency: pocket.currency,
            openingBalanceMinor: pocket.openingBalanceMinor,
            openingRateToBase: await openingRateFor({ database, ws, currency: pocket.currency, openedOn, openingBalanceMinor: pocket.openingBalanceMinor, typed: pocket.typedRate, resolveRates }),
          });
        }
        await openPocketedAccount(database, ws, { item, name, bank: bank.trim() || undefined, openedOn, pockets: settled });
        await invalidate();
        await navigate({ to: '/accounts' });
        return;
      }
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, currency) : 0;
      const openingRateToBase = await openingRateFor({ database, ws, currency, openedOn, openingBalanceMinor, typed: manualRate, resolveRates });
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
        sourceAccountId: source?.id,
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
    /* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */
    <form ref={form} onSubmit={submit}>
      <ErrorBox error={error} />
      <InsetGroup
        header={`${chosen.label}${locked ? ' · cannot be spent from directly' : ''}`}
        footer={
          <>
            {chosen.sub}. The picker chose what kind of account this is. Name is what you call yours.
            {locked && ' When it matures, move the money to an account with a transfer.'}
          </>
        }
      >
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA Tahapan" required />
        {asks.includes('balance') && !pocketed && (
          <TextRow
            label="Balance now"
            aria-describedby={balanceHint}
            /* The sentence keeps its id, so the box still says out loud which line explains it. */
            hint={<span id={balanceHint}>{source ? `Optional. Moves from ${source.name} as a transfer.` : 'Optional. Posted as an opening balance.'}</span>}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
        )}
        {/* Only worth asking when a figure has been typed: nothing moves into an account opened at zero. */}
        {asks.includes('balance') && !pocketed && typedBalance > 0 && (
          <SelectRow
            label="Where the money comes from"
            hint="An account here makes this a transfer from it, so its balance drops too."
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Already there (opening balance)</option>
            {sources.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectRow>
        )}
        {asks.includes('bank') && <TextRow label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="BCA" />}
        {canPocket && (
          <SwitchRow
            label="Holds more than one currency"
            hint="Off for an account that holds one currency. On for one that keeps several currencies inside it."
            checked={pocketed}
            onChange={(on) => {
              setPocketed(on);
              if (on && pockets.length === 0) {
                const first = { currency: ws.baseCurrency, balance: '', rate: '' };
                setPockets([first, { currency: nextPocketCurrency([first]), balance: '', rate: '' }]);
              }
            }}
          />
        )}
        {asks.includes('currency') && !pocketed && (
          <SelectRow
            label="Currency"
            value={currency}
            onChange={(e) => {
              const next = e.target.value;
              setCurrency(next);
              // A source that does not hold what this account will: the answer no longer stands, so it is cleared.
              if (source && source.currency !== next) setSourceId('');
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </SelectRow>
        )}
        {asks.includes('matures') && <TextRow label="Matures on" type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)} required />}
        {asks.includes('rate') && <TextRow label="Interest rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="6,25" />}
        <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        {foreign && !pocketed && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            inputMode="decimal"
          />
        )}
      </InsetGroup>
      {/* A flat array of rows, not a fragment per pocket: `InsetGroup` hands each direct child its position. */}
      {pocketed && (
        <InsetGroup header="Pockets" footer="Leave a rate blank and the rate for the opening date is used. Fill it in only when you want your own figure.">
          {pockets.flatMap((pocket, i) => [
            <SelectRow key={`c${i}`} label={`Pocket ${i + 1}`} value={pocket.currency} onChange={(e) => setPockets((rows) => choosePocketCurrency(rows, i, e.target.value))}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </SelectRow>,
            <TextRow key={`b${i}`} label={`Opening ${pocket.currency}`} value={pocket.balance} onChange={(e) => setPocket(i, { balance: e.target.value })} inputMode="decimal" placeholder="0" />,
            ...(pocket.currency !== ws.baseCurrency
              ? [
                  <TextRow
                    key={`r${i}`}
                    label={`Rate: ${ws.baseCurrency} per 1 ${pocket.currency}`}
                    hint={ratePreview(pocket.rate, pocket.currency, ws.baseCurrency) ?? 'Optional.'}
                    value={pocket.rate}
                    onChange={(e) => setPocket(i, { rate: e.target.value })}
                    inputMode="decimal"
                  />,
                ]
              : []),
          ])}
          <InsetRow title="Add another currency" onClick={() => setPockets((rows) => [...rows, { currency: nextPocketCurrency(rows), balance: '', rate: '' }])} />
          {pockets.length > 2 && <InsetRow title="Remove the last pocket" onClick={() => setPockets((rows) => rows.slice(0, -1))} />}
        </InsetGroup>
      )}
      <InsetGroup>
        {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
        <InsetRow title="Add account" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
      </InsetGroup>
    </form>
  );
}
