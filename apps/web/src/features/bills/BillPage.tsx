import { billSchedule, dayMonth, isoDate, monthName } from '@expanses/core';
import { deleteExpenseTemplate, RecurringError, skipBill, undoBillPayments } from '@expanses/db';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Money } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { isSettled, pillOf } from './bill-view';
import { PaySheet } from './PaySheet';
import { useBillDetail } from './queries';

const ROUND_LINK = 'flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200/70';

interface JustPaid {
  ids: string[];
  amountMinor: number;
  paidOn: string;
  month: string;
}

export function BillRoute() {
  const { billId } = useParams({ from: '/bills/$billId' });
  return <BillPage billId={billId} />;
}

/**
 * A bill on its own: what it is, when it is due, every month's history, and the one thing the list has no room
 * for — paying it and staying to see what happened, rather than bouncing back to the list.
 */
export function BillPage({ billId }: { billId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  const detail = useBillDetail(billId, today);

  const [paying, setPaying] = useState(false);
  const [justPaid, setJustPaid] = useState<JustPaid | null>(null);
  const [error, setError] = useState<unknown>(null);

  // A stopped bill's own page turns into this: gone from the list, but its history is still there if anyone asks.
  if (detail.error instanceof RecurringError && detail.error.code === 'NOT_FOUND') {
    return (
      <div className="flex flex-col items-center gap-2">
        <Empty>This bill has been stopped.</Empty>
        <Link to="/bills" className="text-sm font-medium text-emerald-800">
          Back to Recurring
        </Link>
      </div>
    );
  }

  if (!detail.data) return <ErrorBox error={detail.error} />;

  const { bill, history, bookName } = detail.data;
  const account = accounts.find((a) => a.id === bill.moneyAccountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const pill = pillOf(bill);
  // The month just paid, which is not always the month the page now speaks for: paying last month's overdue bill, or
  // choosing another month in For, moves the bill on. The confirmation follows the payment, not the bill.
  const paidMonth = justPaid ? history.find((row) => row.month === justPaid.month && row.state === 'paid') : undefined;

  async function undo() {
    if (!justPaid) return;
    setError(null);
    try {
      await undoBillPayments(database, ws, justPaid.ids);
      await invalidate();
      setJustPaid(null);
    } catch (e) {
      setError(e);
    }
  }

  async function skip() {
    setError(null);
    try {
      await skipBill(database, ws, bill.id, bill.billMonth);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function stop() {
    // Keeps every payment and skip on record; it just stops asking for the next one.
    if (!window.confirm(`Stop ${bill.name}? Its payments stay in your history.`)) return;
    setError(null);
    try {
      await deleteExpenseTemplate(database, ws, bill.id);
      await invalidate();
      await navigate({ to: '/bills' });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 flex items-center justify-between">
        <Link to="/bills" aria-label="Back" className={ROUND_LINK}>
          <ChevronLeft size={18} aria-hidden />
        </Link>
        <Link to="/bills/$billId/edit" params={{ billId }} aria-label="Edit bill" className={ROUND_LINK}>
          <Pencil size={16} aria-hidden />
        </Link>
      </div>

      <ErrorBox error={error} />

      <section data-testid="bill-hero" className="flex flex-col items-center gap-1 text-center">
        <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="lg" />
        <h1 className="text-lg font-semibold">{bill.name}</h1>
        <span className="text-3xl font-semibold">{bill.amountMinor !== null ? <Money minor={bill.amountMinor} currency={currency} /> : 'Amount varies'}</span>
        <span className="text-sm text-slate-500">{billSchedule(bill.dayOfMonth, bill.payByDay)}</span>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', pill.className)}>{pill.text}</span>
      </section>

      {justPaid && paidMonth && (
        <div data-testid="just-paid" role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>
            ✓ Paid <Money minor={justPaid.amountMinor} currency={currency} /> on {dayMonth(justPaid.paidOn)}
            {justPaid.month !== bill.billMonth && ` · ${monthName(justPaid.month, 'long')} bill`}
          </span>
          <button type="button" onClick={() => void undo()} className="min-h-11 font-semibold">
            Undo
          </button>
        </div>
      )}

      {!isSettled(bill) && (
        <Button className="w-full" onClick={() => setPaying(true)}>
          Pay {monthName(bill.billMonth, 'long')} bill
        </Button>
      )}

      <Card className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Paid from</span>
          <span>{account?.name ?? ''}</span>
        </div>
        {bookName && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Workspace</span>
            <span>{bookName}</span>
          </div>
        )}
      </Card>

      <h2 className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">History</h2>
      <div data-testid="bill-history">
        <Card className="divide-y divide-slate-100">
          {history.map((row) => (
            <div
              key={row.month}
              data-new={paidMonth?.month === row.month}
              className={cx('flex justify-between py-2 text-sm', paidMonth?.month === row.month && 'rounded-lg bg-emerald-50 px-2')}
            >
              <span>{monthName(row.month, 'long')} bill</span>
              <span>
                {row.state === 'paid' ? (
                  <>
                    <Money minor={row.paidMinor ?? 0} currency={currency} /> · paid {dayMonth(row.paidOn!)}
                  </>
                ) : row.state === 'skipped' ? (
                  'Skipped'
                ) : (
                  pillOf({ ...row, paidOn: null }).text
                )}
              </span>
            </div>
          ))}
        </Card>
      </div>

      {!isSettled(bill) && (
        <button type="button" onClick={() => void skip()} className="self-center text-sm font-medium text-slate-600">
          Skip {monthName(bill.billMonth, 'long')} bill
        </button>
      )}

      <button type="button" onClick={() => void stop()} className="self-center text-sm font-medium text-red-700">
        Stop this bill
      </button>

      {paying && (
        <PaySheet
          bill={bill}
          today={today}
          onClose={() => setPaying(false)}
          onPaid={(ids, amountMinor, paidOn, month) => {
            setPaying(false);
            setJustPaid({ ids, amountMinor, paidOn, month });
          }}
          onSkipped={() => setPaying(false)}
        />
      )}
    </div>
  );
}
