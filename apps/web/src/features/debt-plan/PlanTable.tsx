import { formatMinor } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { Panel, ProgressBar } from '../../ui/native';
import { ratePerWords, type PayFirstRow } from './plan-view';
import { debtDestination, PAY_BUTTON, PlaceBadge } from './PayFirstRowView';
import { PayLink } from './PayLink';

const HEAD = 'px-[12px] py-[8px] text-left text-[11.5px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';
const CELL = 'px-[12px] py-[10px] align-middle text-[14px] text-[var(--ph-ink)]';

function rateCell(row: PayFirstRow): string {
  const { debt } = row;
  if (debt.kind !== 'loan') return '0%';
  return debt.hasTerms && debt.rateBps !== null ? ratePerWords(debt.rateBps, debt.ratePer) : 'No terms yet';
}

/** The wide Plan's numbered list (spec §4.5): #, Debt, Rate, Progress, Left, and Pay — late rows with "!" and their tag. */
export function PlanTable({ rows }: { rows: readonly PayFirstRow[] }) {
  return (
    <Panel pad={false} wide>
      <table className="w-full border-collapse" data-testid="plan-table">
        <thead>
          <tr className="border-b border-[var(--ph-hair)]">
            <th className={HEAD}>#</th>
            <th className={HEAD}>Debt</th>
            <th className={HEAD}>Rate</th>
            <th className={HEAD}>Progress</th>
            <th className={`${HEAD} text-right`}>Left</th>
            <th className={HEAD}>
              <span className="sr-only">Pay</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { debt } = row;
            return (
              <tr key={debt.key} data-testid="plan-table-row" data-name={debt.name} className="border-b border-[var(--ph-hair)] last:border-b-0">
                <td className={`${CELL} w-[44px]`}>
                  <PlaceBadge place={row.place} />
                </td>
                <td className={CELL}>
                  <Link {...debtDestination(debt)} className="ph-focus rounded font-medium hover:underline">
                    {debt.name}
                  </Link>
                  <span className="mt-[2px] flex items-center gap-[6px] text-[12.5px] text-[var(--ph-ink-3)]">
                    {row.lateTag && <span className="whitespace-nowrap rounded-[4px] bg-[var(--ph-alarm-panel)] px-[5px] font-semibold text-[var(--ph-alarm)]">{row.lateTag}</span>}
                    {row.extraTag && <span className="font-semibold text-[var(--ph-up)]">{row.extraTag}</span>}
                  </span>
                </td>
                <td className={`${CELL} whitespace-nowrap text-[var(--ph-ink-2)]`}>{rateCell(row)}</td>
                <td className={`${CELL} w-[22%] min-w-[120px]`}>
                  <ProgressBar currentMinor={debt.repaidMinor} targetMinor={Math.max(1, debt.borrowedMinor)} label={`${debt.name} repaid`} />
                </td>
                <td className={`${CELL} tabular text-right whitespace-nowrap`}>{formatMinor(debt.leftMinor, debt.currency)}</td>
                <td className={`${CELL} w-[72px] text-right`}>
                  {row.pay && (
                    <PayLink target={row.pay} className={`${PAY_BUTTON} inline-flex`} label={`Pay ${debt.name}`}>
                      Pay
                    </PayLink>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
