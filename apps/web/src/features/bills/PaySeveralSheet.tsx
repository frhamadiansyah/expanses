import { parseMajor } from '@expanses/core';
import { type MonthlyBill, recordBillPayments } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Input, Money } from '../../ui';
import { pillOf } from './bill-view';

/**
 * Paying several bills on one day: the ticked bills each become their own payment against their own
 * category, so a fixed one needs nothing typed and one that varies asks what it came to. Unticking a bill
 * here leaves it exactly as it was — a way to change your mind before anything is recorded.
 */
export function PaySeveralSheet({
  bills,
  picked,
  today,
  onClose,
  onPaid,
}: {
  /** Every unsettled bill this month, so the sheet can offer more than what was picked on the list. */
  bills: MonthlyBill[];
  picked: ReadonlySet<string>;
  today: string;
  onClose: () => void;
  onPaid: (ids: string[], count: number) => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const currencyOf = (moneyAccountId: string) => accounts.find((account) => account.id === moneyAccountId)?.currency ?? ws.baseCurrency;

  // The picked bills lead, since that is what was chosen on the list; the rest follow in the order they came in.
  const ordered = [...bills.filter((bill) => picked.has(bill.id)), ...bills.filter((bill) => !picked.has(bill.id))];

  const [ticked, setTicked] = useState<Set<string>>(() => new Set(picked));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function record() {
    setError(null);
    setBusy(true);
    try {
      const chosen = bills.filter((bill) => ticked.has(bill.id));
      const payments = chosen.map((bill) => {
        const currency = currencyOf(bill.moneyAccountId);
        const typed = amounts[bill.id]?.trim();
        return { templateId: bill.id, billMonth: bill.billMonth, amountMinor: bill.amountMinor ?? (typed ? parseMajor(typed, currency) : 0) };
      });
      if (payments.some((payment) => !(payment.amountMinor > 0))) {
        setError('Enter the amount of each ticked bill that varies');
        return;
      }
      const ids = await recordBillPayments(database, ws, { paidOn, payments });
      await invalidate();
      onPaid(ids, ids.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Pay several" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl ring-1 ring-slate-200">
          {ordered.map((bill) => (
            <div key={bill.id} className="flex min-h-12 items-center gap-3 border-t border-slate-100 px-3 first:border-t-0">
              <input
                type="checkbox"
                className="h-5 w-5"
                aria-label={`Pay ${bill.name}`}
                checked={ticked.has(bill.id)}
                onChange={() => toggle(bill.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{bill.name}</span>
                <span className="block text-xs text-slate-500">{pillOf(bill).text}</span>
              </span>
              {bill.amountMinor !== null ? (
                <Money minor={bill.amountMinor} currency={currencyOf(bill.moneyAccountId)} />
              ) : (
                <Input
                  className="w-32"
                  inputMode="decimal"
                  aria-label={`What ${bill.name} came to`}
                  placeholder="Amount"
                  value={amounts[bill.id] ?? ''}
                  onChange={(e) => setAmounts((current) => ({ ...current, [bill.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="several-on" className="text-sm">
            Paid on
          </label>
          <Input id="several-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="w-auto" />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <Button onClick={() => void record()} disabled={ticked.size === 0 || busy} className="w-full">
          {ticked.size === 0 ? 'Record' : `Record ${ticked.size} ${ticked.size === 1 ? 'bill' : 'bills'}`}
        </Button>
      </div>
    </Sheet>
  );
}
