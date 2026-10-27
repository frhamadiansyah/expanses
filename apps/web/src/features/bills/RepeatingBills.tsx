import { dayMonth, feeDaysAway, formatMinor, isoDate } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { cx, Money } from '../../ui';
import { GROUP_RADIUS, InsetGroup, InsetRow, Panel, ProgressBar, ROW_PAD_X, ROW_PAD_Y, rowHeight, toneClass } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
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

/**
 * Every yearly and every-few-months bill in the order they fall due: one group, a row opens its bill. A row is drawn as
 * a Monthly bill is (BillRow): the category's round icon, the name with the paying account under it, the amount at the
 * right with when it falls due under that, and the chevron.
 */
export function RepeatingList({ bills }: { bills: readonly MonthlyBill[] }) {
  const { ws } = useApp();
  const from = useFrom();
  const navigate = useNavigate();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  const sorted = bills.map((bill) => ({ bill, next: nextDateOf(bill) })).sort((a, b) => a.next.localeCompare(b.next));
  if (sorted.length === 0) {
    return (
      <InsetGroup>
        <InsetRow testId="repeating-empty" title={<span className="text-[var(--ph-ink-3)]">No repeating bills yet</span>} chevron={false} />
      </InsetGroup>
    );
  }
  return (
    <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS, overflow: 'hidden' }}>
      {sorted.map(({ bill, next }, index) => {
        const amount = bill.amountMinor ?? bill.estimateMinor;
        const currency = billCurrencyOf(bill, accounts, ws.baseCurrency);
        const account = accounts.find((row) => row.id === bill.moneyAccountId)?.name ?? '';
        const soon = feeDaysAway(next, today) <= 30;
        return (
          <div key={bill.id} data-testid="yearly-bill-row" className="relative">
            {index > 0 && <span aria-hidden className="pointer-events-none absolute top-0 right-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
            <button
              type="button"
              onClick={() => void navigate({ to: '/bills/$billId', params: { billId: bill.id }, search: from })}
              className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
              style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
            >
              <span className="relative h-[28px] w-[28px] shrink-0">
                <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{bill.name}</span>
                <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
                  {account}
                  {bill.repeat === 'months' ? `${account ? ' · ' : ''}every ${bill.repeatEvery} months` : ''}
                </span>
              </span>
              <span className="tabular flex shrink-0 flex-col items-end text-[15px] leading-[20px] text-[var(--ph-ink)]">
                {amount === null ? <span className="text-[var(--ph-ink-3)]">Amount varies</span> : <Money minor={amount} currency={currency} />}
                <span className={cx('mt-[2px] text-[12.5px] leading-[16px]', toneClass(soon ? 'warn' : 'ink-3'))}>{`Due ${dayMonth(next)}`}</span>
              </span>
              <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)]">
                {'›'}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
