import { minorToMajorString, monthName, parseMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments, skipBill } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { WALLET_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, ErrorBox, Input, Money, Select } from '../../ui';
const ROW = 'flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 px-3 first:border-t-0';

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
        <Input
          aria-label="What it came to"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="text-center text-3xl font-semibold md:text-3xl"
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

        <div className="rounded-xl ring-1 ring-slate-200">
          <div className={ROW}>
            <label htmlFor="pay-for" className="text-sm">
              For
            </label>
            <Select id="pay-for" value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto border-0 text-right">
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m, 'long')} bill
                </option>
              ))}
            </Select>
          </div>
          <div className={ROW}>
            <label htmlFor="pay-with" className="text-sm">
              Paid with
            </label>
            <Select id="pay-with" value={payer} onChange={(e) => setPayer(e.target.value)} className="w-auto border-0 text-right">
              {wallets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </div>
          <div className={ROW}>
            <label htmlFor="pay-on" className="text-sm">
              Paid on
            </label>
            <Input id="pay-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-auto border-0 text-right" />
          </div>
        </div>

        {missing && (
          <p role="alert" className="text-sm text-red-700">
            Enter what it came to
          </p>
        )}
        <ErrorBox error={error} />

        <Button type="submit" className="w-full" disabled={busy}>
          Record payment
        </Button>

        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => void skip()} disabled={busy} className="min-h-11 text-sm font-medium text-slate-600">
            Skip this month
          </button>
          {onSeeBill && (
            <button type="button" onClick={onSeeBill} className="min-h-11 text-sm font-medium text-emerald-800">
              See bill ›
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
