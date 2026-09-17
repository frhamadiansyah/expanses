import { formatMinor, isoDate, parseMajor } from '@expanses/core';
import { type MonthlyBill, monthlyBills, postTransaction, skipBill } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, Input, Money } from '../../ui';

const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** How late a bill is, in the words you would use about it. */
function lateness(bill: MonthlyBill, today: string): string {
  const days = Number(today.slice(8, 10)) - bill.dayOfMonth;
  return days <= 0 ? 'due today' : days === 1 ? '1 day late' : `${days} days late`;
}

function useBills(today: string) {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['monthly-bills', ws.workspaceId, today], queryFn: () => monthlyBills(database, ws, today) });
}

/**
 * The month's recurring bills, as one line above the transactions.
 *
 * Rent, internet and the gym are the predictable part of a month, so the useful question is not "which are
 * late" but "how much of this month is already spoken for". The line answers that; the sheet behind it is
 * where anything is recorded.
 */
export function Recurring({ today = isoDate() }: { today?: string }) {
  const { ws } = useApp();
  const bills = useBills(today);
  const [open, setOpen] = useState(false);
  const rows = bills.data ?? [];
  if (rows.length === 0) return null;

  const settled = rows.filter((bill) => bill.state === 'paid' || bill.state === 'skipped');
  const owed = rows.filter((bill) => bill.state === 'owed');
  const owedMinor = owed.reduce((sum, bill) => sum + (bill.amountMinor ?? 0), 0);
  const done = settled.length === rows.length;

  return (
    <>
      {/* The same card as a category group below it, so the bills read as one more line of the list. */}
      <Card>
        <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-3 text-left" data-testid="recurring-card">
          <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', done ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-700')}>
            <Receipt size={18} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Recurring</span>
            <span className="block truncate text-xs text-slate-500">
              {settled.length} of {rows.length} {rows.length === 1 ? 'bill' : 'bills'} paid
            </span>
          </span>
          {/* What is still owed sits where a category group puts its total, and reads the same way. */}
          {owed.length > 0 && <Money minor={owedMinor} currency={ws.baseCurrency} className="shrink-0 text-sm font-semibold" />}
          <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
        </button>
      </Card>
      {open && <RecurringSheet today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Everything recurring, in the order it needs you: what is owed now, what is still to come, what is done.
 *
 * The owed ones are ticked and recorded together, the way card purchases are paid — one date for the lot,
 * because bills are caught up on in batches and each would otherwise land on the day it was typed.
 */
function RecurringSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const bills = useBills(today);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const rows = bills.data ?? [];
  const owed = rows.filter((bill) => bill.state === 'owed');
  const later = rows.filter((bill) => bill.state === 'later');
  const done = rows.filter((bill) => bill.state === 'paid' || bill.state === 'skipped');
  const currencyOf = (bill: MonthlyBill) => accounts.find((account) => account.id === bill.moneyAccountId)?.currency ?? ws.baseCurrency;
  const chosen = rows.filter((bill) => picked.has(bill.id));
  /** A bill with no fixed amount contributes what you typed, and nothing until you do. */
  const amountOf = (bill: MonthlyBill) => bill.amountMinor ?? (amounts[bill.id]?.trim() ? parseMajor(amounts[bill.id]!.trim(), currencyOf(bill)) : 0);
  const ready = chosen.length > 0 && chosen.every((bill) => amountOf(bill) > 0);

  const toggle = (id: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function record() {
    setError(null);
    setBusy(true);
    try {
      for (const bill of chosen) {
        const currency = currencyOf(bill);
        const amountMinor = amountOf(bill);
        if (!(amountMinor > 0)) throw new Error(`Enter what ${bill.name} came to this month`);
        await postTransaction(database, ws, {
          occurredOn: paidOn,
          description: bill.name,
          templateId: bill.id,
          lines: [
            { accountId: bill.categoryAccountId, amountMinor, currency },
            { accountId: bill.moneyAccountId, amountMinor: -amountMinor, currency },
          ],
        });
      }
      setPicked(new Set());
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function skip(bill: MonthlyBill) {
    setError(null);
    try {
      await skipBill(database, ws, bill.id, today.slice(0, 7));
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const row = (bill: MonthlyBill, extra?: React.ReactNode) => (
    <div key={bill.id} className="flex min-h-12 items-center gap-3 border-t border-slate-100 py-2 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{bill.name}</span>
        <span className="block truncate text-xs text-slate-500">
          the {ordinal(bill.dayOfMonth)}
          {bill.state === 'owed' && <b className="font-semibold text-amber-700"> · {lateness(bill, today)}</b>}
          {bill.state === 'paid' && bill.paidOn && ` · paid ${day(bill.paidOn)}`}
          {bill.state === 'skipped' && ' · skipped this month'}
        </span>
      </span>
      {bill.amountMinor !== null ? (
        <Money minor={bill.paidMinor ?? bill.amountMinor} currency={currencyOf(bill)} className="shrink-0 text-sm font-semibold" />
      ) : bill.state === 'owed' && picked.has(bill.id) ? (
        <Input
          className="w-28 shrink-0"
          inputMode="decimal"
          aria-label={`What ${bill.name} came to`}
          value={amounts[bill.id] ?? ''}
          onChange={(event) => setAmounts({ ...amounts, [bill.id]: event.target.value })}
          placeholder="Amount"
        />
      ) : (
        <span className="shrink-0 text-sm text-slate-400">—</span>
      )}
      {extra}
    </div>
  );

  return (
    <Sheet title="Recurring" onClose={onClose}>
      <div data-testid="recurring-sheet">
        <ErrorBox error={error} />
        {owed.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-amber-700 uppercase">Owed now</h3>
            {owed.map((bill) =>
              row(
                bill,
                <>
                  <button type="button" onClick={() => void skip(bill)} className="shrink-0 px-1 text-xs font-medium text-slate-500 hover:text-slate-900">
                    Skip
                  </button>
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0"
                    checked={picked.has(bill.id)}
                    onChange={() => toggle(bill.id)}
                    aria-label={`Pay ${bill.name}`}
                  />
                </>,
              ),
            )}
            {/* One date for the lot: a week of bills caught up on a Sunday were not all paid on Sunday. */}
            <div className="mt-2 flex items-end gap-2">
              <label className="flex-1 text-xs text-slate-500">
                Paid on
                <Input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
              </label>
              <Button disabled={!ready || busy} onClick={() => void record()}>
                Record {chosen.length || ''} {chosen.length === 1 ? 'bill' : 'bills'}
              </Button>
            </div>
          </section>
        )}

        {later.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Later this month</h3>
            {later.map((bill) =>
              row(
                bill,
                <button type="button" onClick={() => toggle(bill.id)} className="shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium">
                  {picked.has(bill.id) ? 'Chosen' : 'Pay early'}
                </button>,
              ),
            )}
          </section>
        )}

        {done.length > 0 && (
          <section className="mb-4 opacity-60">
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Already paid</h3>
            {done.map((bill) => row(bill))}
          </section>
        )}

        <Link to="/bills" onClick={onClose} className="flex min-h-11 items-center text-sm font-medium text-emerald-800">
          Every recurring bill ›
        </Link>
      </div>
    </Sheet>
  );
}
