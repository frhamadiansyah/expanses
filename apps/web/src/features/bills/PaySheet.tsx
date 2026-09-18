import { minorToMajorString, monthName, parseMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, skipBill } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, InputRow, Money, RowGroup, SelectRow } from '../../ui';

/**
 * What it came to, written big and bare in the middle of the sheet. No box around it: it is the one thing the sheet is
 * asking for, and a border would only make it look like the three quiet rows below.
 */
const HERO =
  'w-full rounded-lg bg-transparent py-1 text-center text-3xl font-semibold tabular text-slate-900 placeholder:text-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

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
  const wallets = accounts.filter((account) => WALLET_SUBTYPES.includes(account.subtype) && account.archivedAt === null);
  const currencyOf = (id: string) => accounts.find((account) => account.id === id)?.currency ?? ws.baseCurrency;

  const [amount, setAmount] = useState(() => (bill.amountMinor === null ? '' : minorToMajorString(bill.amountMinor, currencyOf(bill.moneyAccountId))));
  const [month, setMonth] = useState(bill.payableMonths[0] ?? bill.billMonth);
  const [payer, setPayer] = useState(bill.moneyAccountId);
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const currency = currencyOf(payer);
  const months = bill.payableMonths.length > 0 ? bill.payableMonths : [bill.billMonth];

  async function record(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMissing(false);
    setBusy(true);
    try {
      const amountMinor = amount.trim() ? parseMajor(amount.trim(), currency) : 0;
      if (!(amountMinor > 0)) {
        setMissing(true);
        return;
      }
      const ids = await recordBillPayments(database, ws, { paidOn, payments: [{ templateId: bill.id, billMonth: month, amountMinor, moneyAccountId: payer }] });
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

  return (
    <Sheet title={`Pay ${bill.name}`} onClose={onClose}>
      <form onSubmit={record} className="space-y-3">
        <div className="space-y-1 pb-1">
          <input
            aria-label="What it came to"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={HERO}
            placeholder={bill.amountMinor === null ? 'What it came to' : undefined}
          />
          {bill.amountMinor === null && (
            <p className="text-center text-xs text-slate-500">
              {bill.estimateMinor === null ? (
                'Amount varies'
              ) : (
                <>
                  Amount varies · last month <Money minor={bill.estimateMinor} currency={currency} />
                </>
              )}
            </p>
          )}
        </div>

        <RowGroup>
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
          <InputRow label="Paid on" id="pay-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </RowGroup>

        {missing && (
          <p role="alert" className="text-center text-sm text-red-700">
            Enter what it came to
          </p>
        )}
        <ErrorBox error={error} />

        <Button type="submit" variant="success" className="w-full" disabled={busy}>
          Record payment
        </Button>

        {/* Quiet beside the green button: neither is the thing the sheet was opened to do. */}
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => void skip()} disabled={busy} className="min-h-11 px-1 text-sm font-medium text-slate-600 disabled:opacity-50">
            Skip this month
          </button>
          {onSeeBill && (
            <button type="button" onClick={onSeeBill} className="min-h-11 px-1 text-sm font-medium text-slate-600">
              See bill ›
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
