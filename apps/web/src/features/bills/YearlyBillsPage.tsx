import { addMonths, billWindow, dayMonth, isoDate, monthName } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { billCurrencyOf } from './bill-view';
import { useYearlyBills } from './queries';

/** The date a yearly bill comes out next: this year's while it is still to come or unpaid, else the one a year on. */
export function nextDateOf(bill: MonthlyBill): string {
  const settled = bill.state === 'paid' || bill.state === 'skipped' || bill.state === 'paused';
  return settled ? billWindow(addMonths(bill.billMonth, 12), bill.dayOfMonth, bill.payByDay).opensOn : bill.window.opensOn;
}

/** Every yearly bill, all year round: Recurring lists one only in the weeks before its date. */
export function YearlyBillsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const from = useFrom();
  const bills = useYearlyBills(today);
  const accounts = useAccounts().data ?? [];
  const rows = bills.data ?? [];
  return (
    <div className={SCREEN}>
      <LargeTitle title="Yearly bills" back="Recurring" backTo="/bills" backSearch={from} />
      <ErrorBox error={bills.error} />
      {bills.isSuccess && rows.length === 0 && (
        <InsetGroup>
          <InsetRow title={<span className="text-[var(--ph-tint)]">New bill</span>} label="New bill" to="/bills/new" />
        </InsetGroup>
      )}
      {rows.length > 0 && (
        <InsetGroup>
          {rows.map((bill) => {
            const next = nextDateOf(bill);
            const amount = bill.amountMinor ?? bill.estimateMinor;
            return (
              <InsetRow
                key={bill.id}
                testId="yearly-bill-row"
                title={bill.name}
                subtitle={`${monthName(`2026-${String(bill.repeatMonth).padStart(2, '0')}`, 'long')} ${bill.dayOfMonth} · next ${dayMonth(next)} ${next.slice(0, 4)}`}
                value={amount === null ? 'Varies' : <Money minor={amount} currency={billCurrencyOf(bill, accounts, ws.baseCurrency)} />}
                valueTone="ink"
                to="/bills/$billId"
                params={{ billId: bill.id }}
                search={from}
              />
            );
          })}
        </InsetGroup>
      )}
    </div>
  );
}
