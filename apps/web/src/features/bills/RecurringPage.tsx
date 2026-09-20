import { isoDate } from '@expanses/core';
import { type MonthlyBill, skipBill, undoBillPayments, unskipBill } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ListChecks, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Money, PageHeader, RoundButton } from '../../ui';
import { BillRow } from './BillRow';
import { amountOf, billsInReadCurrency, isSettled, paidText, sectionsOf, skippedText, summaryOf } from './bill-view';
import { PaySeveralSheet } from './PaySeveralSheet';
import { PaySheet } from './PaySheet';
import { useMonthlyBills } from './queries';
import { useBookMoney } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { UndoToast } from '../../ui/UndoToast';

const SECONDARY_LINK = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900 ring-1 ring-slate-300 hover:bg-slate-100';

const LINE_TONE = { overdue: 'text-red-700', dueSoon: 'text-amber-700', later: 'text-slate-500' } as const;

/**
 * The month's bills, most urgent first: what is still to pay, what is late, and what is done. A row pays or skips with a
 * swipe on a phone, or through its ⋯ menu with a mouse; either way an Undo follows for a few seconds.
 */
export function RecurringPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const bills = useMonthlyBills(today);
  const accounts = useAccounts().data ?? [];
  const rows = bills.data ?? [];

  const [paying, setPaying] = useState<MonthlyBill | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payingSeveral, setPayingSeveral] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // Stable, so the sheet does not re-run its open effect (and take focus back) whenever the list refreshes.
  const closeSheet = useCallback(() => setPaying(null), []);
  const closeSeveral = useCallback(() => setPayingSeveral(false), []);

  const toggle = (bill: MonthlyBill) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(bill.id)) next.delete(bill.id);
      else next.add(bill.id);
      return next;
    });

  const doneSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const currencyOf = (bill: MonthlyBill) => accounts.find((account) => account.id === bill.moneyAccountId)?.currency ?? ws.baseCurrency;

  // Each row says what its own bill costs, in the money it is paid with. The totals add rows up, so they cannot:
  // every amount is brought into the currency this workspace reads in first, and what no rate reaches is left out
  // of the sum and named above it, rather than added in as though a dollar were a rupiah.
  const money = useBookMoney().data;
  const readCurrency = money?.currency ?? ws.baseCurrency;
  const { rows: readRows, unconverted } = billsInReadCurrency(rows, money, currencyOf);

  const pay = (bill: MonthlyBill) => setPaying(bill);

  async function skip(bill: MonthlyBill) {
    setError(null);
    const month = bill.billMonth;
    try {
      await skipBill(database, ws, bill.id, month);
      await invalidate();
      setToast({ text: skippedText(bill.name, month, today), undo: () => unskipBill(database, ws, bill.id, month) });
    } catch (e) {
      setError(e);
    }
  }

  const paid = (bill: MonthlyBill) => (ids: string[]) => {
    setPaying(null);
    setToast({ text: `Paid ${bill.name}`, undo: () => undoBillPayments(database, ws, ids) });
  };

  async function undo() {
    if (!toast) return;
    const t = toast;
    setToast(null);
    try {
      await t.undo();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const summary = summaryOf(readRows, today);

  return (
    <div className="space-y-3">
      <PageHeader
        title={selecting ? `${picked.size} selected` : 'Recurring'}
        controls={
          selecting ? (
            <Button variant="secondary" onClick={doneSelecting}>
              Done
            </Button>
          ) : (
            <>
              <RoundButton label="Select bills to pay" onClick={() => setSelecting(true)}>
                <ListChecks size={18} aria-hidden />
              </RoundButton>
              <RoundButton label="New bill" onClick={() => void navigate({ to: '/bills/new' })}>
                <Plus size={18} aria-hidden />
              </RoundButton>
            </>
          )
        }
        action={
          selecting ? (
            <Button variant="secondary" onClick={doneSelecting}>
              Done
            </Button>
          ) : (
            <span className="flex items-center gap-2">
              <Button variant="secondary" aria-label="Select bills to pay" onClick={() => setSelecting(true)}>
                Select
              </Button>
              <Link to="/bills/new" aria-label="New bill" className={SECONDARY_LINK}>
                + New bill
              </Link>
            </span>
          )
        }
      />

      <ErrorBox error={error ?? bills.error} />

      {bills.isSuccess && rows.length === 0 && (
        <div className="flex flex-col items-center">
          <Empty>No bills set up. The phone, the water, the gas — whatever comes round.</Empty>
          <Link to="/bills/new" className={SECONDARY_LINK}>
            New bill
          </Link>
        </div>
      )}

      {rows.length > 0 && (
        <div data-testid="bills-summary" className="space-y-2">
          <Unconverted missing={unconverted} currency={readCurrency} />
          <Card className="space-y-1">
            <span className="block text-xs text-slate-500">Still to pay in {summary.monthLabel}</span>
            <span className="block text-3xl font-semibold tabular">
              {summary.approximate && '~'}
              <Money minor={summary.totalMinor} currency={readCurrency} />
              {summary.variesText && <span className="text-sm font-normal text-slate-500"> · {summary.variesText}</span>}
            </span>
            {summary.lines.map((line) => (
              <div key={line.key} className="flex justify-between text-sm">
                <span className={LINE_TONE[line.key]}>{line.label}</span>
                <span>
                  {line.approximate && '~'}
                  <Money minor={line.minor} currency={readCurrency} />
                </span>
              </div>
            ))}
            {summary.allSettled && (
              <div className="flex justify-between text-sm text-emerald-700">
                <span>All paid for {summary.monthLabel}</span>
                <span aria-hidden>✓</span>
              </div>
            )}
          </Card>
        </div>
      )}

      {sectionsOf(rows).map((section) => (
        <section key={section.key}>
          <h2
            className={cx(
              'mt-4 mb-1 px-1 text-[11px] font-semibold tracking-wide uppercase',
              section.key === 'overdue' ? 'text-red-700' : section.key === 'dueSoon' ? 'text-amber-700' : 'text-slate-500',
            )}
          >
            {section.title}
          </h2>
          {/* Card's look without its padding or clipping: rows run edge to edge, and a row's menu may hang below it. */}
          <div className={cx('rounded-xl bg-white shadow-sm ring-1 ring-slate-200', section.key === 'settled' && 'opacity-60')}>
            {section.rows.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                accounts={accounts}
                today={today}
                currency={currencyOf(bill)}
                onPay={pay}
                onSkip={(b) => void skip(b)}
                selecting={selecting}
                picked={picked.has(bill.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        </section>
      ))}

      {selecting && picked.size > 0 && (() => {
        const chosen = readRows.filter((b) => picked.has(b.id));
        const approximate = chosen.some((b) => b.amountMinor === null);
        return (
          <button
            type="button"
            onClick={() => setPayingSeveral(true)}
            className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-12 max-w-md items-center justify-between rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-lg md:sticky md:bottom-6 md:mt-4 md:w-full"
          >
            <span>Pay {picked.size} selected</span>
            <span>
              {approximate && '~'}
              <Money minor={chosen.reduce((s, b) => s + amountOf(b), 0)} currency={readCurrency} /> ›
            </span>
          </button>
        );
      })()}

      {toast && <UndoToast text={toast.text} onUndo={() => void undo()} onDone={clearToast} />}

      {payingSeveral && (
        <PaySeveralSheet
          bills={rows.filter((b) => !isSettled(b))}
          picked={picked}
          today={today}
          onClose={closeSeveral}
          onPaid={(ids, names) => {
            setPayingSeveral(false);
            setSelecting(false);
            setPicked(new Set());
            // Named from what the sheet recorded: its ticks can differ from what was picked on the list.
            setToast({ text: paidText(names), undo: () => undoBillPayments(database, ws, ids) });
          }}
        />
      )}

      {paying && (
        <PaySheet
          bill={paying}
          today={today}
          onClose={closeSheet}
          onPaid={paid(paying)}
          onSkipped={(month) => {
            const b = paying;
            setPaying(null);
            setToast({ text: skippedText(b.name, month, today), undo: () => unskipBill(database, ws, b.id, month) });
          }}
          onSeeBill={() => navigate({ to: '/bills/$billId', params: { billId: paying.id } })}
        />
      )}
    </div>
  );
}
