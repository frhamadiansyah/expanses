import { addMonths, billWindow, dayMonth, isoDate } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { billCurrencyOf } from './bill-view';
import { useYearlyBills } from './queries';

/** The date a yearly or every-few-months bill comes out next: the one it speaks for while still to come or unpaid, else the occurrence after it. */
export function nextDateOf(bill: MonthlyBill): string {
  const settled = bill.state === 'paid' || bill.state === 'skipped' || bill.state === 'paused';
  return settled ? billWindow(addMonths(bill.billMonth, bill.repeat === 'months' ? bill.repeatEvery! : 12), bill.dayOfMonth, bill.payByDay).opensOn : bill.window.opensOn;
}

/** Every yearly and every-few-months bill, all year round: Recurring lists one only in the weeks before its date. */
export function YearlyBillsPage() {
  const { ws } = useApp();
  const today = isoDate();
  const from = useFrom();
  const bills = useYearlyBills(today);
  const accounts = useAccounts().data ?? [];
  const rows = bills.data ?? [];
  return (
    <div className={SCREEN}>
      <LargeTitle title="Repeating bills" back="Recurring" backTo="/bills" backSearch={from} />
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
                subtitle={`Due ${dayMonth(next)}${bill.repeat === 'months' ? ` · every ${bill.repeatEvery} months` : ''}`}
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
