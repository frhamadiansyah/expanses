import { isoDate } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Receipt } from 'lucide-react';
import { useApp } from '../../app/context';
import { Card, cx, Money } from '../../ui';
import { useAccounts } from '../../lib/queries';
import { billsInReadCurrency, isSettled, owedNow } from '../bills/bill-view';
import type { MonthlyBill } from '@expanses/db';
import { useMonthlyBills } from '../bills/queries';
import { useBookMoney } from '../workspaces/queries';

/**
 * The month's recurring bills, as one line above the transactions.
 *
 * Rent, internet and the gym are the predictable part of a month, so the useful question is not "which are
 * late" but "how much of this month is already spoken for". The line answers that; the Recurring screen
 * behind it is where anything is recorded.
 */
export function Recurring({ today = isoDate() }: { today?: string }) {
  const { ws } = useApp();
  const rows = useMonthlyBills(today).data ?? [];
  const accounts = useAccounts().data ?? [];
  // The same conversion the Recurring screen does, so the two figures agree: each bill is brought into the money
  // this workspace reads in before they are added up. Until it arrives the figure is held back rather than shown
  // as a sum of several currencies labelled as one.
  const money = useBookMoney();
  const currencyOf = (bill: MonthlyBill) => accounts.find((account) => account.id === bill.moneyAccountId)?.currency ?? ws.baseCurrency;
  const { rows: readRows } = billsInReadCurrency(rows, money.data, currencyOf);
  if (rows.length === 0) return null;

  const settled = readRows.filter(isSettled).length;
  const owed = owedNow(readRows);
  const done = settled === readRows.length;
  const readCurrency = money.data?.currency ?? ws.baseCurrency;

  return (
    // The same card as a category group below it, so the bills read as one more line of the list.
    <Card>
      <Link to="/bills" className="flex w-full items-center gap-3 text-left" data-testid="recurring-card">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', done ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-700')}>
          <Receipt size={18} strokeWidth={2.2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Recurring</span>
          <span className="block truncate text-xs text-slate-500">
            {settled} of {readRows.length} {readRows.length === 1 ? 'bill' : 'bills'} paid
          </span>
        </span>
        {/* What is still owed sits where a category group puts its total, and reads the same way. */}
        {money.isSuccess && owed.minor > 0 && (
          <span className="shrink-0 text-sm font-semibold">
            {owed.approximate && '~'}
            <Money minor={owed.minor} currency={readCurrency} />
          </span>
        )}
        <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-300" />
      </Link>
    </Card>
  );
}
