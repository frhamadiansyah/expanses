import { type BudgetLine, formatBp, formatMinor, monthName } from '@expanses/core';
import type { AccountRow, BudgetRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { cx } from '../../ui';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { CategoryIcon } from '../categories/CategoryIcon';
import { bareFigure, dayMonth } from '../networth/debt-rows';
import { flatten, type SpendHistory } from './budget-view';
import { type Tone, toneOf } from './budget-desk-model';
import { FREQUENCY_WORDS } from './frequency-form';
import { useCategoryItems } from './queries';

export const TONE_COLOUR: Record<Tone, string> = { ok: 'var(--ph-up)', near: 'var(--ph-warn)', over: 'var(--ph-alarm)' };

/** How the budget was set, in words: "Rp 500.000 a week", "20% of Food", "November only". */
function budgetWords(stored: BudgetRow | undefined, parentName: string | null, month: string, currency: string): string {
  if (!stored) return 'None';
  if (stored.overridden) return `${formatMinor(stored.amountMinor, currency)}, ${monthName(month, 'long')} only`;
  if (stored.share) return `${formatBp(stored.share.bp)}% of ${stored.share.basis === 'parent' ? (parentName ?? 'its parent') : 'take-home'}`;
  return `${formatMinor(stored.amountAsSetMinor, currency)} ${FREQUENCY_WORDS[stored.frequency].per}`;
}

/**
 * A category's side peek (Mac Budget): what it spent this month against its budget, how that budget was set, what it
 * spent before, and the month's transactions in it (everything under it for a parent) — each a click from its receipt.
 * Edit budget opens the category's own cap sheet: Just this month, the unit, Remove budget.
 */
export function CategoryPeek({
  top,
  line,
  stored,
  parentName,
  countsAs,
  history,
  month,
  currency,
  accounts,
  first,
  last,
  onStep,
  onClose,
  onEditBudget,
}: {
  top: number;
  line: BudgetLine;
  stored: BudgetRow | undefined;
  parentName: string | null;
  countsAs: string;
  history: SpendHistory | null;
  month: string;
  currency: string;
  accounts: readonly AccountRow[];
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onEditBudget: () => void;
}) {
  const navigate = useNavigate();
  const ids = flatten([line]).map((each) => each.id);
  const items = useCategoryItems(ids, month);
  const tone = toneOf(line.capMinor, line.totalMinor);
  const left = line.capMinor === null ? null : line.capMinor - line.totalMinor;
  const share = line.capMinor === null ? 0 : line.capMinor > 0 ? line.totalMinor / line.capMinor : line.totalMinor > 0 ? 1 : 0;
  const rows: { label: string; value: string; muted?: boolean }[] = [
    { label: 'Budget', value: budgetWords(stored, parentName, month, currency), muted: !stored },
    { label: 'Counts as', value: countsAs || '—', muted: true },
    { label: 'Last month', value: history ? formatMinor(history.lastMinor, currency) : '–' },
    { label: '3-month average', value: history ? formatMinor(history.averageMinor, currency) : '–' },
  ];
  const list = items.data?.items ?? [];
  return (
    <SidePeek
      top={top}
      label="Category details"
      testId="category-peek"
      titleTestId="peek-title"
      noun="category"
      title={
        <span className="inline-flex items-center gap-[7px]">
          <CategoryIcon categoryId={line.id} accounts={accounts} size="xs" />
          {line.name}
        </span>
      }
      first={first}
      last={last}
      onStep={onStep}
      onClose={onClose}
    >
      <div className="px-[14px] pb-[10px]">
        <div className="text-[11px] text-[var(--ph-ink-3)]">Spent in {monthName(month, 'long')}</div>
        <div data-testid="peek-amount" className="text-[22px] font-semibold text-[var(--ph-ink)] tabular-nums">
          {formatMinor(line.totalMinor, currency)}
        </div>
        <div data-testid="peek-left" className={cx('mt-[2px] text-[13px]', left !== null && left < 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]')}>
          {left === null ? 'No budget' : left < 0 ? `${formatMinor(-left, currency)} over ${formatMinor(line.capMinor!, currency)}` : `${formatMinor(left, currency)} left of ${formatMinor(line.capMinor!, currency)}`}
        </div>
        {tone && (
          <div aria-hidden className="mt-[8px] h-[6px] overflow-hidden rounded-full bg-[var(--ph-track)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(1, share) * 100}%`, background: TONE_COLOUR[tone] }} />
          </div>
        )}
      </div>
      <dl className="border-t border-[var(--ph-hair)]">
        {rows.map((row) => (
          <div key={row.label} className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px] first:border-t-0">
            <dt className="w-[118px] shrink-0 text-[var(--ph-ink-3)]">{row.label}</dt>
            <dd className={cx('min-w-0 flex-1 break-words tabular-nums', row.muted ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 px-[14px] pt-[12px] pb-[6px]">
        <button type="button" className={PEEK_BUTTON} onClick={onEditBudget}>
          Edit budget
        </button>
      </div>
      <h3 className="flex items-baseline justify-between px-[14px] pt-[10px] pb-[4px] text-[11px] font-semibold text-[var(--ph-ink-3)]">
        <span>Transactions</span>
        {items.isSuccess && <span className="font-normal">{list.length === 1 ? '1 transaction' : `${list.length} transactions`}</span>}
      </h3>
      <ul aria-label={`${line.name} transactions`} className="pb-3">
        {items.isSuccess && list.length === 0 && <li className="px-[14px] py-2 text-[12.5px] text-[var(--ph-ink-3)]">Nothing spent in {monthName(month, 'long')}.</li>}
        {list.map((item, index) => (
          <li key={`${item.transactionId ?? 'plan'}:${item.onDate}:${index}`}>
            <button
              type="button"
              data-testid="peek-item"
              disabled={!item.transactionId}
              onClick={() => item.transactionId && void navigate({ to: '/transactions/$transactionId', params: { transactionId: item.transactionId } })}
              className="flex w-full items-baseline gap-2 px-[14px] py-[5px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:hover:bg-transparent"
            >
              <span className="w-[44px] shrink-0 text-[12px] text-[var(--ph-ink-3)] tabular-nums">{dayMonth(item.onDate)}</span>
              <span className="min-w-0 flex-1 truncate">
                {item.description || <span className="text-[var(--ph-ink-3)]">No note</span>}
                {item.instalment && (
                  <span className="ml-1 rounded-full bg-[var(--ph-fill)] px-[6px] text-[11px] text-[var(--ph-ink-2)] tabular-nums">
                    {item.instalment.number} of {item.instalment.of}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{bareFigure(item.amountMinor, currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </SidePeek>
  );
}
