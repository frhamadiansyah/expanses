import { capsByNeed, monthRange, needsPlan } from '@expanses/core';
import type { BudgetSheetResult } from '@expanses/db';
import { cx, Money } from '../../ui';
import { type GroupChild, InsetGroup } from '../../ui/native';
import { useEssentialSplit, useResolvedNeeds } from './queries';
import { type NeedsBoxRow, needsBoxRows, SPLIT_TITLE } from './split-view';

function Rows({ rows, currency }: GroupChild & { rows: readonly NeedsBoxRow[]; currency: string }) {
  return (
    <div className="space-y-[14px] px-[16px] py-[14px]">
      {rows.map((row) => (
        <div key={row.key} data-testid={`needs-${row.key}`}>
          <div className="mb-[6px] flex items-baseline justify-between gap-3 text-[15px] leading-[20px]">
            <span className="text-[var(--ph-ink)]">{row.label}</span>
            <span className={cx('tabular text-right text-[13px] leading-[18px]', row.warn ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]')} data-testid={`needs-${row.key}-figure`}>
              <Money minor={row.usedMinor} currency={currency} />
              {row.plannedMinor !== null && (
                <>
                  {' of '}
                  <Money minor={row.plannedMinor} currency={currency} />
                </>
              )}
            </span>
          </div>
          {row.plannedMinor !== null && (
            <span aria-hidden className="block h-[6px] w-full overflow-hidden rounded-full bg-[var(--ph-track)]">
              <span className="block h-full rounded-full" style={{ width: `${row.fill}%`, background: row.colour }} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The Budget page's Essential · Lifestyle · Debts & savings box: what each used this month of what the caps plan for
 * it. Used is the same figure Cashflow's Income page 2 shows for the month; planned is the caps under each mark, and
 * Debts & savings the take-home (or the income so far) less both.
 */
export function NeedsBox({ sheet, month }: { sheet: BudgetSheetResult; month: string }) {
  const range = monthRange(month);
  const split = useEssentialSplit(range);
  const needs = useResolvedNeeds();
  if (!split.data || !needs.data) return null;
  const rows = needsBoxRows(needsPlan(split.data.split, capsByNeed(sheet.lines, needs.data), sheet.incomePlanMinor));
  return (
    <InsetGroup header={SPLIT_TITLE}>
      <Rows rows={rows} currency={split.data.currency} />
    </InsetGroup>
  );
}
