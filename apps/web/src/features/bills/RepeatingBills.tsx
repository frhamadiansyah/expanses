import { dayMonth, formatMinor } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { Money } from '../../ui';
import { InsetGroup, InsetRow, Panel, ProgressBar } from '../../ui/native';
import { shortMoney } from '../networth/value-chart';
import { billCurrencyOf } from './bill-view';
import type { SetAside } from './set-aside';
import { nextDateOf } from './YearlyBillsPage';

/** A figure in the caption: millions short, as the charts print them, else the whole amount. */
function brief(minor: number, currency: string): string {
  return currency === 'IDR' && Math.abs(minor) >= 1e6 ? `Rp ${shortMoney(minor, currency)}` : formatMinor(minor, currency);
}

/** The Repeating page's hero, in the Monthly hero's own box: what is set aside each month and how much of the targets is saved. */
export function RepeatingHero({ setAside, currency }: { setAside: SetAside; currency: string }) {
  return (
    <Panel className="space-y-3" testId="repeating-summary">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Set aside · per month</p>
        <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="set-aside-total">
          {setAside.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          <Money minor={setAside.monthlyMinor} currency={currency} />
        </p>
      </div>
      {setAside.count === 0 ? (
        <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">No sinking funds yet</p>
      ) : (
        <>
          <ProgressBar currentMinor={setAside.savedMinor} targetMinor={setAside.targetMinor} label="Saved of the targets" />
          <p className="tabular text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            Saved {brief(setAside.savedMinor, currency)} of {brief(setAside.targetMinor, currency)} for {setAside.count} {setAside.count === 1 ? 'bill' : 'bills'}
          </p>
        </>
      )}
    </Panel>
  );
}

/** Every yearly and every-few-months bill in the order they fall due: one group, a row opens its bill. */
export function RepeatingList({ bills }: { bills: readonly MonthlyBill[] }) {
  const { ws } = useApp();
  const from = useFrom();
  const accounts = useAccounts().data ?? [];
  const sorted = bills.map((bill) => ({ bill, next: nextDateOf(bill) })).sort((a, b) => a.next.localeCompare(b.next));
  return (
    <InsetGroup>
      {sorted.length === 0 ? (
        <InsetRow testId="repeating-empty" title={<span className="text-[var(--ph-ink-3)]">No repeating bills yet</span>} chevron={false} />
      ) : (
        sorted.map(({ bill, next }) => {
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
        })
      )}
    </InsetGroup>
  );
}
