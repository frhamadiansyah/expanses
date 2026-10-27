import { dayMonth, feeDaysAway, formatMinor, isoDate } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { cx, Money } from '../../ui';
import { GROUP_RADIUS, InsetGroup, InsetRow, Panel, ROW_PAD_X, ROW_PAD_Y, rowHeight, toneClass } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { billCurrencyOf } from './bill-view';
import type { RepeatingNeeds } from './repeating-needs';
import { nextDateOf } from './YearlyBillsPage';

/** The Repeating page's hero, in the Monthly hero's own box: what the repeating bills need each month from now, and how much of it sinking funds already back. */
export function RepeatingHero({ needs, currency }: { needs: RepeatingNeeds; currency: string }) {
  const { fundedMinor, unfundedMinor, totalMinor } = needs;
  return (
    <Panel className="space-y-3" testId="repeating-summary">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Needed · per month, from now</p>
        <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="needed-total">
          {needs.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          <Money minor={totalMinor} currency={currency} />
        </p>
      </div>
      {needs.bills.length === 0 ? (
        <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">No repeating bills yet</p>
      ) : (
        totalMinor > 0 && (
          <>
            <span aria-hidden className="flex w-full overflow-hidden rounded-full bg-[var(--ph-track)]" style={{ height: 8 }}>
              <span className="block h-full" style={{ width: `${(fundedMinor / totalMinor) * 100}%`, background: 'var(--ph-up)' }} />
              <span className="block h-full" style={{ width: `${(unfundedMinor / totalMinor) * 100}%`, background: 'var(--ph-warn)' }} />
            </span>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="repeating-legend">
              {fundedMinor > 0 && <KeyItem colour="var(--ph-up)" label="Set aside" minor={fundedMinor} currency={currency} />}
              {unfundedMinor > 0 && <KeyItem colour="var(--ph-warn)" label="Not set aside" minor={unfundedMinor} currency={currency} />}
            </ul>
          </>
        )
      )}
    </Panel>
  );
}

function KeyItem({ colour, label, minor, currency }: { colour: string; label: string; minor: number; currency: string }) {
  return (
    <li className="flex items-center gap-[6px]">
      <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: colour }} />
      {label}{' '}
      <span className="tabular text-[var(--ph-ink-2)]">
        <Money minor={minor} currency={currency} />
      </span>
    </li>
  );
}

/**
 * Every yearly and every-few-months bill in the order they fall due: one group, a row opens its bill. A row is drawn as
 * a Monthly bill is (BillRow): the category's round icon, the name with the paying account under it, the amount at the
 * right with when it falls due under that, and the chevron.
 */
export function RepeatingList({ bills, needs }: { bills: readonly MonthlyBill[]; needs: RepeatingNeeds }) {
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
        const need = needs.bills.find((row) => row.billId === bill.id);
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
                  <span className={toneClass(soon ? 'warn' : 'ink-3')}>{`Due ${dayMonth(next)}`}</span>
                  {bill.repeat === 'months' ? ` · every ${bill.repeatEvery} months` : ''}
                </span>
              </span>
              <span className="tabular flex shrink-0 flex-col items-end text-[15px] leading-[20px] text-[var(--ph-ink)]">
                {amount === null ? <span className="text-[var(--ph-ink-3)]">Amount varies</span> : <Money minor={amount} currency={currency} />}
                {need && need.needMinor !== null && (
                  <span className={cx('mt-[2px] text-[12.5px] leading-[16px]', toneClass(need.funded ? 'ink-3' : 'warn'))}>{`${formatMinor(need.needMinor, need.currency)} a month`}</span>
                )}
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
