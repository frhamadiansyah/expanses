import { dayMonth, formatMinor } from '@expanses/core';
import type { MonthlyBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { useFrom } from '../../app/from-search';
import { useAccounts } from '../../lib/queries';
import { Money } from '../../ui';
import { GROUP_GAP, GROUP_RADIUS, InsetGroup, InsetRow, Panel, PanelHeader, ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { billCurrencyOf } from './bill-view';
import type { AnnualFee } from '../cards/fee-due';
import { FeeRow } from './FeeRow';
import type { RepeatingNeeds } from './repeating-needs';
import { nextDateOf } from './YearlyBillsPage';

/** The Repeating page's hero, in the Monthly hero's own box: what the repeating bills need each month from now, and how much of it sinking funds already back. */
export function RepeatingHero({ needs, currency }: { needs: RepeatingNeeds; currency: string }) {
  const { fundedMinor, unfundedMinor, totalMinor } = needs;
  return (
    <Panel className="space-y-3" testId="repeating-summary">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Needed · per month</p>
        <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="needed-total">
          {needs.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          <Money minor={totalMinor} currency={currency} />
        </p>
        {/* The second line the Monthly hero has too, so the two cards are the same shape when the slider moves. */}
        {needs.bills.length > 0 && totalMinor > 0 ? (
          <p className="tabular text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="needed-year">
            {needs.approximate && '≈ '}
            <Money minor={totalMinor * 12} currency={currency} /> a year
          </p>
        ) : (
          <span aria-hidden className="block h-[17px]" />
        )}
      </div>
      {/* The Monthly box's shape in every state (owner, 22 Nov 2026): no repeating bills keeps the bar, as an empty
          track, and the key, saying so in one line, so sliding between the two never changes the card. */}
      <span aria-hidden className="flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]" style={{ height: 8 }}>
        {totalMinor > 0 && (
          <>
            <span className="block h-full" style={{ width: `${(fundedMinor / totalMinor) * 100}%`, background: 'var(--ph-up)' }} />
            <span className="block h-full" style={{ width: `${(unfundedMinor / totalMinor) * 100}%`, background: 'var(--ph-warn)' }} />
          </>
        )}
      </span>
      <ul className="flex min-h-[78px] flex-col text-[12.5px] leading-[26px] text-[var(--ph-ink-3)]" data-testid="repeating-legend">
        {needs.bills.length === 0 && <li className="flex h-[26px] items-center">No repeating bills yet</li>}
        {fundedMinor > 0 && <KeyItem colour="var(--ph-up)" label="Set aside" minor={fundedMinor} currency={currency} />}
        {unfundedMinor > 0 && <KeyItem colour="var(--ph-warn)" label="Not set aside" minor={unfundedMinor} currency={currency} />}
      </ul>
    </Panel>
  );
}

export function KeyItem({ colour, label, minor, currency, testId }: { colour: string; label: string; minor: number; currency: string; testId?: string }) {
  return (
    <li className="flex h-[26px] items-center gap-[6px]" data-testid={testId}>
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
  const sorted = bills.map((bill) => ({ bill, next: nextDateOf(bill) })).sort((a, b) => a.next.localeCompare(b.next));
  if (sorted.length === 0) {
    return (
      <InsetGroup>
        <InsetRow testId="repeating-empty" title={<span className="text-[var(--ph-ink-3)]">No repeating bills yet</span>} chevron={false} />
      </InsetGroup>
    );
  }
  return (
    <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }}>
      {/* Yearly bills and every-few-months bills together, in the order they fall due: the hero's "a year" adds all of them. */}
      <PanelHeader title="Through the year" />
      <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS, overflow: 'hidden' }}>
      {sorted.map(({ bill, next }, index) => {
        const amount = bill.amountMinor ?? bill.estimateMinor;
        const currency = billCurrencyOf(bill, accounts, ws.baseCurrency);
        const need = needs.bills.find((row) => row.billId === bill.id);
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
                  {`Due ${dayMonth(next)}`}
                  {bill.repeat === 'months' ? ` · every ${bill.repeatEvery} months` : ''}
                </span>
              </span>
              <span className="tabular flex shrink-0 flex-col items-end text-[15px] leading-[20px] text-[var(--ph-ink)]">
                {amount === null ? <span className="text-[var(--ph-ink-3)]">Amount varies</span> : <Money minor={amount} currency={currency} />}
                {need && need.needMinor !== null && (
                  <span className="mt-[2px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{`${formatMinor(need.needMinor, need.currency)} a month`}</span>
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
    </section>
  );
}

/**
 * Each credit card's annual fee, drawn as the Monthly page's fee row is. Information only: nothing here is added to the
 * hero's need, because a fee is often waived. A tap opens Fee waived.
 */
export function AnnualFees({ fees, onOpen }: { fees: readonly AnnualFee[]; onOpen: (fee: AnnualFee) => void }) {
  if (fees.length === 0) return null;
  return (
    <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="annual-fees">
      <PanelHeader title="Annual fees" />
      <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS, overflow: 'hidden' }}>
        {fees.map((fee, index) => (
          <FeeRow key={fee.card.cardId} fee={fee} separator={index > 0} onOpen={() => onOpen(fee)} />
        ))}
      </div>
    </section>
  );
}
