import { minorToMajorString, monthName, parseMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, skipBill } from '@expanses/db';
import { type FormEvent, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, SelectRow, TextRow } from '../../ui/native';
import { billCurrencyOf } from './bill-view';
import { chargedEstimateText, useChargedRates } from './charged';
import { spendingDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';

/**
 * What it came to, written big and bare in the middle of the sheet. No box around it: it is the one thing the sheet is
 * asking for, and a border would only make it look like the three quiet rows below.
 */
const HERO =
  'w-full rounded-lg bg-transparent py-1 text-center text-3xl font-semibold tabular text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ph-ink)]';

/**
 * Paying one bill: what it came to, which month's bill it settles, what paid it and when. A fixed bill comes filled in,
 * so it is one press; one that varies starts empty, because a remembered figure would only be a guess.
 */
export function PaySheet({
  bill,
  today,
  onClose,
  onPaid,
  onSkipped,
  onSeeBill,
}: {
  bill: MonthlyBill;
  today: string;
  onClose: () => void;
  onPaid: (transactionIds: string[], amountMinor: number, paidOn: string, billMonth: string) => void;
  onSkipped: (billMonth: string) => void;
  /** Shown only when the sheet was opened from the list. */
  onSeeBill?: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const wallets = moneyHolders(accounts).filter((account) => canPayWith(account));
  const currencyOf = (id: string) => accounts.find((account) => account.id === id)?.currency ?? ws.baseCurrency;

  const [amount, setAmount] = useState(() => (bill.amountMinor === null ? '' : minorToMajorString(bill.amountMinor, billCurrencyOf(bill, accounts, ws.baseCurrency))));
  const [month, setMonth] = useState(bill.payableMonths[0] ?? bill.billMonth);
  const [payer, setPayer] = useState(bill.moneyAccountId);
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the account was charged, once it has been typed in; null while the row still shows the estimate.
  const [charged, setCharged] = useState<string | null>(null);
  const payerCurrency = currencyOf(payer);
  // The bill's own currency; a bill with none follows whichever account pays it, so choosing another here moves it along.
  const currency = bill.currency ?? payerCurrency;
  const foreign = currency !== payerCurrency;
  const months = bill.payableMonths.length > 0 ? bill.payableMonths : [bill.billMonth];
  /** The one reading of the typed figure: Save throws what it says, the question reads 0 until it parses. */
  const readAmount = () => (amount.trim() ? parseMajor(amount.trim(), currency) : 0);
  const typedMinor = (() => {
    try {
      return readAmount();
    } catch {
      return 0;
    }
  })();
  const rates = useChargedRates(foreign ? [currency, payerCurrency] : [], paidOn);
  const estimate = foreign ? chargedEstimateText({ amountMinor: typedMinor, billCurrency: currency, payerCurrency, rates, baseCurrency: ws.baseCurrency }) : '';
  const chargedShown = charged ?? estimate;
  /** The account is charged this in its own money: what the bank took, which is what the set-aside question is about. */
  const chargedMinor = (() => {
    try {
      return chargedShown.trim() ? parseMajor(chargedShown.trim(), payerCurrency) : 0;
    } catch {
      return 0;
    }
  })();
  const setAside = useSetAside(spendingDoor(payer, foreign ? chargedMinor : typedMinor));

  async function record(event: FormEvent) {
    event.preventDefault();
    // The Record row submits the form, so Enter records too: the question is a condition on both.
    if (!setAside.ready) return;
    setError(null);
    setMissing(false);
    setBusy(true);
    try {
      const amountMinor = readAmount();
      if (!(amountMinor > 0)) {
        setMissing(true);
        return;
      }
      let chargedAmount: number | undefined;
      if (foreign) {
        // Parsed here so a figure that does not parse still says so; an empty row is asked for rather than guessed.
        chargedAmount = chargedShown.trim() ? parseMajor(chargedShown.trim(), payerCurrency) : 0;
        if (!(chargedAmount > 0)) {
          setError(new Error(`Enter what the account was charged in ${payerCurrency}`));
          return;
        }
      }
      const ids = await recordBillPayments(database, ws, {
        paidOn,
        payments: [{ templateId: bill.id, billMonth: month, amountMinor, chargedMinor: chargedAmount, moneyAccountId: payer, setAside: setAside.choice }],
      });
      await invalidate();
      onPaid(ids, amountMinor, paidOn, month);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setError(null);
    setBusy(true);
    try {
      await skipBill(database, ws, bill.id, month);
      await invalidate();
      onSkipped(month);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const form = useRef<HTMLFormElement>(null);
  const submit = () => form.current?.requestSubmit();
  const grey = '[&_span]:!text-[var(--ph-ink-3)]';

  return (
    <Sheet grouped title={`Pay ${bill.name}`} onClose={onClose}>
      <form ref={form} onSubmit={record}>
        <div className="space-y-1 pb-4 pt-1">
          <input
            aria-label="What it came to"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={HERO}
            placeholder={bill.amountMinor === null ? 'What it came to' : undefined}
          />
          {foreign && (
            <p className="text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="pay-bill-currency">
              Amount in {currency}
            </p>
          )}
          {bill.amountMinor === null && (
            <p className="text-center text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              {bill.estimateMinor === null ? (
                'Amount varies'
              ) : (
                <>
                  Amount varies, last month <Money minor={bill.estimateMinor} currency={currency} tone="none" />
                </>
              )}
            </p>
          )}
        </div>

        <InsetGroup>
          <SelectRow label="For" id="pay-for" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m, 'long')} bill
              </option>
            ))}
          </SelectRow>
          <SelectRow label="Paid with" id="pay-with" value={payer} onChange={(e) => setPayer(e.target.value)}>
            {wallets.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </SelectRow>
          <TextRow label="Paid on" id="pay-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          {foreign && (
            <TextRow
              label={`Charged in ${payerCurrency}`}
              id="pay-charged"
              inputMode="decimal"
              value={chargedShown}
              onChange={(e) => setCharged(e.target.value)}
              placeholder={`Charged in ${payerCurrency}`}
              info={`What the account was charged, as its statement shows. It starts as an estimate at the latest rate known, and can be changed to the real figure.`}
            />
          )}
        </InsetGroup>

        {missing && (
          <p role="alert" className="pb-3 text-center text-sm text-[var(--ph-alarm)]">
            Enter what it came to
          </p>
        )}
        {setAside.node}
        <ErrorBox error={error} />

        {/* Lets Enter in a field record, as the row below does; the row is the one the reader sees and taps. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} disabled={busy || !setAside.ready} />

        <InsetGroup>
          <InsetRow action title="Record payment" disabled={busy || !setAside.ready} onClick={submit} />
          <InsetRow action title="Skip this month" disabled={busy} onClick={() => void skip()} className={grey} />
          {onSeeBill && <InsetRow action title="See bill" onClick={onSeeBill} className={grey} />}
        </InsetGroup>
      </form>
    </Sheet>
  );
}
