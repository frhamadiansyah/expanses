import { bankMatches, cashItem, CURRENCIES, isoDate, type MoneyAccountSubtype, parseMajor, parseRate } from '@expanses/core';
import { openCashAccount, openPocketedAccount } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor, ratePreview } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { CurrencyRow, type GroupChild, InsetGroup, InsetRow, ROW_PAD_X, SelectRow, SwitchRow, TAP, TextRow } from '../../ui/native';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { currencyFlag } from '../transactions/tx-form';
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
/**
 * How a form is drawn inside a sheet's step rather than on its own page: the sheet's ✓ submits the `<form>` by its
 * id, so the form draws no button of its own, and it says whether it can be saved yet so the ✓ can be dimmed.
 */
export interface EmbeddedForm {
  formId: string;
  onCanSave: (canSave: boolean) => void;
}

/**
 * An account at a bank on one row: the bank where the label would be, grey "Bank ›" until chosen, and the name typed
 * at the right. Typing the bank in a rupiah workspace offers Indonesia's banks over the keyboard, the way the currency
 * field offers codes; anything else typed is kept as typed. The bank is only the tax report's, so it stays optional.
 */
function BankNameRow({
  bank,
  onBank,
  name,
  onName,
  offersBanks,
  position,
}: GroupChild & { bank: string; onBank: (bank: string) => void; name: string; onName: (name: string) => void; offersBanks: boolean }) {
  const [typing, setTyping] = useState(false);
  const offered = typing && offersBanks ? bankMatches(bank) : [];
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `0 ${ROW_PAD_X}px` }}>
        <span className="flex min-w-0 max-w-[55%] shrink items-center gap-[6px]">
          {/* As wide as its text, so the › sits right after the bank: an unseen copy of the text sets the width. */}
          <span className="inline-grid min-w-0">
            <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre text-[16px] leading-[20px] md:text-[15px]">
              {bank || 'Bank'}
            </span>
            <input
              aria-label="Bank"
              // A field's own minimum is about twenty letters wide; at one, the unseen copy alone sets the width.
              size={1}
              value={bank}
              onChange={(e) => onBank(e.target.value)}
              onFocus={() => setTyping(true)}
              onBlur={() => {
                setTyping(false);
                onBank(bank.trim());
              }}
              autoComplete="off"
              autoCapitalize="words"
              placeholder="Bank"
              className="ph-focus col-start-1 row-start-1 w-full min-w-0 rounded bg-transparent text-[16px] leading-[20px] text-[var(--ph-ink-2)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
            />
          </span>
          <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
            {'›'}
          </span>
        </span>
        <input
          aria-label="Name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Account name"
          required
          className="ph-focus min-w-0 flex-1 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
        />
      </div>
      <KeyboardStrip
        label="Banks"
        cells={offered.map((choice) => ({
          key: choice.name,
          label: choice.name,
          title: choice.also[0] ?? choice.name,
          detail: choice.also.length > 0 ? choice.name : undefined,
          onPick: () => onBank(choice.name),
        }))}
      />
    </div>
  );
}

/** An amount field as wide as what is in it (never narrower than its placeholder), so a rate beside it sits close. */
function amountWidth(value: string): string {
  return `${Math.max(value.length, 6) + 1}ch`;
}

/**
 * An opening rate between a row's label and its amount, split from the amount by a hairline the way a split cell is:
 * grey "Rate" until one is typed, and left empty the day's rate is used.
 */
function RateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <>
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder="Rate"
        className="ph-focus min-w-[56px] flex-1 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink-2)] tabular placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
      />
      <span aria-hidden className="h-[24px] w-[0.5px] shrink-0 bg-[var(--ph-hair)]" />
    </>
  );
}

/**
 * One pocket in one row: its currency on the left — the flag and the code, a real select laid over them so the phone
 * opens its own picker — and what it opens with on the right, as the amount row of a transaction reads.
 */
function PocketRow({
  index,
  currency,
  onCurrency,
  balance,
  onBalance,
  base,
  rate,
  onRate,
  position,
}: GroupChild & {
  index: number;
  currency: string;
  onCurrency: (code: string) => void;
  balance: string;
  onBalance: (value: string) => void;
  /** The workspace's currency: a pocket in it needs no rate. */
  base: string;
  rate: string;
  onRate: (value: string) => void;
}) {
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `0 ${ROW_PAD_X}px` }}>
        <span className="ph-focus-within relative flex shrink-0 items-center gap-[6px] text-[16px] leading-[20px] text-[var(--ph-ink)] md:text-[15px]">
          <span aria-hidden>{currencyFlag(currency)}</span>
          <span aria-hidden className="font-medium">{currency}</span>
          <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
          <select
            aria-label={`Pocket ${index + 1}`}
            value={currency}
            onChange={(e) => onCurrency(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </span>
        {/* A foreign pocket's opening rate, beside its amount behind a hairline: left empty, the day's rate is fetched. */}
        {currency !== base ? <RateField label={`Rate: ${base} per 1 ${currency}`} value={rate} onChange={onRate} /> : <span className="flex-1" />}
        <input
          aria-label={`Opening ${currency}`}
          value={balance}
          onChange={(e) => onBalance(e.target.value)}
          inputMode="decimal"
          placeholder="Amount"
          style={{ width: amountWidth(balance) }}
          className="ph-focus min-w-0 shrink-0 rounded bg-transparent text-right text-[16px] leading-[20px] text-[var(--ph-ink)] tabular placeholder:text-[var(--ph-ink-3)] md:text-[15px]"
        />
      </div>
    </div>
  );
}

export function CashAccountForm({
  item,
  onCreated,
  embedded,
  kinds,
}: {
  item: MoneyAccountSubtype;
  /** Where saving goes instead of Accounts, given the account just made. */
  onCreated?: (accountId: string) => void;
  /** Drawn in a sheet: no heading line, no page sentence, no button — the sheet's ✓ saves it. */
  embedded?: EmbeddedForm;
  /**
   * The kinds this form may open, asked for in its first row — for a sheet, which has no picker screen in front of
   * the form. The caller holds the answer and passes it back as `item`, so switching keeps what was typed.
   */
  kinds?: { items: readonly MoneyAccountSubtype[]; onChange: (item: MoneyAccountSubtype) => void };
}) {
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
  const canSave = !busy && name.trim() !== '';
  const onCanSave = embedded?.onCanSave;
  useEffect(() => onCanSave?.(canSave), [onCanSave, canSave]);

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
        const { parent } = await openPocketedAccount(database, ws, { item, name, bank: bank.trim() || undefined, openedOn, pockets: settled });
        await invalidate();
        if (onCreated) onCreated(parent.id);
        else await navigate({ to: '/accounts' });
        return;
      }
      const openingBalanceMinor = balance.trim() ? parseMajor(balance, currency) : 0;
      const openingRateToBase = await openingRateFor({ database, ws, currency, openedOn, openingBalanceMinor, typed: manualRate, resolveRates });
      const opened = await openCashAccount(database, ws, {
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
      if (onCreated) onCreated(opened.id);
      else await navigate({ to: '/accounts' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rateField = <RateField label={`Rate: ${ws.baseCurrency} per 1 ${currency}`} value={manualRate} onChange={setManualRate} />;

  return (
    /* Still a real `<form>`: Enter in any box saves, exactly as it did when the button below was the submit. */
    <form ref={form} id={embedded?.formId} onSubmit={submit}>
      <ErrorBox error={error} />
      <InsetGroup
        header={embedded ? undefined : `${chosen.label}${locked ? ' · cannot be spent from directly' : ''}`}
        footer={
          embedded ? (
            locked ? 'Cannot be spent from directly. When it matures, move the money to an account with a transfer.' : undefined
          ) : (
            <>
              {chosen.sub.charAt(0).toUpperCase() + chosen.sub.slice(1)}.{asks.includes('bank') ? ' The bank goes on your yearly tax report; the name is what you call it here.' : ' Name is what you call yours.'}
              {locked && ' When it matures, move the money to an account with a transfer.'}
            </>
          )
        }
      >
        {/* A sheet has no picker screen before the form, so the kind is its first row. */}
        {kinds && (
          <SelectRow label="Type" value={item} onChange={(e) => kinds.onChange(e.target.value as MoneyAccountSubtype)}>
            {kinds.items.map((kind) => (
              <option key={kind} value={kind}>
                {cashItem(kind).label}
              </option>
            ))}
          </SelectRow>
        )}
        {asks.includes('bank') ? (
          <BankNameRow bank={bank} onBank={setBank} name={name} onName={setName} offersBanks={ws.baseCurrency === 'IDR'} />
        ) : (
          <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" required />
        )}
        {asks.includes('currency') && !pocketed && (
          <CurrencyRow
            label="Currency"
            value={currency}
            codes={CURRENCIES}
            onChange={(next) => {
              setCurrency(next);
              // A source that does not hold what this account will: the answer no longer stands, so it is cleared.
              if (source && source.currency !== next) setSourceId('');
            }}
          />
        )}
        {asks.includes('matures') && <TextRow label="Matures on" type="date" value={maturesOn} onChange={(e) => setMaturesOn(e.target.value)} required />}
        {asks.includes('rate') && <TextRow label="Interest rate" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="% a year" />}
        <TextRow label="Balance as of" type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} />
        {/* The balance comes after the day it is as of: the date first, then what the account held on it. */}
        {asks.includes('balance') && !pocketed && (
          <TextRow
            label="Balance now"
            aria-describedby={balanceHint}
            /* The sentence keeps its id, so the box still says out loud which line explains it. */
            info={<span id={balanceHint}>{source ? `Optional. Moves from ${source.name} as a transfer.` : 'Optional. Posted as an opening balance.'}{foreign ? ` Rate is ${ws.baseCurrency} per 1 ${currency} on that day; left empty, the day's rate is used.` : ''}</span>}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            inputMode="decimal"
            placeholder="Amount"
            // A foreign account's opening rate on the balance's own line, as a pocket carries it: rate, a hairline, the amount.
            middle={foreign ? rateField : undefined}
            style={foreign ? { width: amountWidth(balance) } : undefined}
            className={foreign ? '!flex-none' : undefined}
            // How a typed rate reads, while one is typed: "16.500" must not pass for 16500 unseen.
            hint={foreign && manualRate.trim() ? (ratePreview(manualRate, currency, ws.baseCurrency) ?? undefined) : undefined}
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
        {foreign && !pocketed && !asks.includes('balance') && (
          <TextRow
            label={`Rate: ${ws.baseCurrency} per 1 ${currency}`}
            hint={ratePreview(manualRate, currency, ws.baseCurrency) ?? 'Leave empty to fetch the daily rate.'}
            value={manualRate}
            onChange={(e) => setManualRate(e.target.value)}
            inputMode="decimal"
          />
        )}
        {canPocket && (
          <SwitchRow
            label="Multi-currency"
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
      </InsetGroup>
      {/* A flat array of rows, not a fragment per pocket: `InsetGroup` hands each direct child its position. */}
      {pocketed && (
        <InsetGroup header="Pockets" footer="Rate is to the workspace’s currency on the opening date. Left empty, that day’s rate is used.">
          {pockets.flatMap((pocket, i) => [
            <PocketRow
              key={`p${i}`}
              index={i}
              currency={pocket.currency}
              onCurrency={(code) => setPockets((rows) => choosePocketCurrency(rows, i, code))}
              balance={pocket.balance}
              onBalance={(balance) => setPocket(i, { balance })}
              base={ws.baseCurrency}
              rate={pocket.rate}
              onRate={(rate) => setPocket(i, { rate })}
            />,
          ])}
          <InsetRow title="Add another currency" onClick={() => setPockets((rows) => [...rows, { currency: nextPocketCurrency(rows), balance: '', rate: '' }])} />
          {pockets.length > 2 && <InsetRow title="Remove the last pocket" onClick={() => setPockets((rows) => rows.slice(0, -1))} />}
        </InsetGroup>
      )}
      {!embedded && (
        <InsetGroup>
          {/* `requestSubmit` rather than calling `submit` straight: the browser still checks `required` first. */}
          <InsetRow title="Add account" chevron={false} onClick={() => !busy && form.current?.requestSubmit()} className={busy ? 'opacity-40' : undefined} />
        </InsetGroup>
      )}
    </form>
  );
}
