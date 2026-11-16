import { formatMinor, isoDate } from '@expanses/core';
import { Link } from '@tanstack/react-router';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox } from '../../ui';
import { Panel, PushedTitle, SCREEN } from '../../ui/native';
import { repaidPercent } from '../loans/loan-view';
import { allDebtsSubtitle, chipCounts, type DebtFilter, debtGroups, type DebtSort, filterDebts, type GroupedDebtRow, readSort, SORTS, sortDebts, writeSort } from './all-debts-view';
import { useInstallments } from '../loans/queries';
import { Hair } from './ByHandList';
import { debtDestination } from './PayFirstRowView';
import type { PlanDebt } from './plan-inputs';
import { useDebtPlan } from './queries';

const CHIPS: { key: DebtFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'late', label: 'Late' },
  { key: 'paidOff', label: 'Paid off' },
];

/** The sort, as a button that names it and a short menu of the five (spec §4.3). */
function SortMenu({ sort, onSort }: { sort: DebtSort; onSort: (sort: DebtSort) => void }) {
  const [open, setOpen] = useState(false);
  const label = SORTS.find((s) => s.key === sort)?.label ?? 'Most left';
  return (
    <div className="relative mb-[10px] flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ph-focus flex items-center gap-1 rounded-full px-[10px] py-[6px] text-[15px] font-medium text-[var(--ph-tint)]"
        onClick={() => setOpen((o) => !o)}
      >
        {`Sort: ${label}`}
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Sort" className="absolute top-full right-0 z-20 mt-1 min-w-[180px] overflow-hidden rounded-[12px] bg-[var(--ph-surface)] shadow-[0_8px_24px_rgba(0,0,0,0.16)]">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="menuitemradio"
              aria-checked={s.key === sort}
              className="ph-focus flex w-full items-center justify-between px-[14px] py-[11px] text-left text-[15px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]"
              onClick={() => {
                onSort(s.key);
                setOpen(false);
              }}
            >
              {s.label}
              {s.key === sort && <Check size={16} aria-hidden className="text-[var(--ph-tint)]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DebtLine({ debt, today, first }: { debt: PlanDebt; today: string; first: boolean }) {
  const percent = repaidPercent(debt.borrowedMinor, debt.leftMinor);
  return (
    <li data-testid="all-debts-row" data-name={debt.name} className="relative">
      {!first && <Hair />}
      <Link {...debtDestination(debt)} className="ph-focus flex items-center gap-3 px-[16px] py-[11px]">
        <span aria-hidden className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[13px] font-semibold text-[var(--ph-ink-2)]">
          {debt.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[16px] leading-[21px] font-medium text-[var(--ph-ink)]">{debt.name}</span>
            <span className={`tabular shrink-0 text-[15px] ${debt.paidOff ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]'}`}>{formatMinor(debt.leftMinor, debt.currency)}</span>
          </span>
          {!debt.paidOff && (
            <span
              role="progressbar"
              aria-label={`${debt.name} repaid`}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="mt-[6px] block h-[4px] overflow-hidden rounded-full bg-[var(--ph-track)]"
            >
              <span className={`block h-full rounded-full ${debt.late ? 'bg-[var(--ph-alarm)]' : 'bg-[var(--ph-up)]'}`} style={{ width: `${percent}%` }} />
            </span>
          )}
          <span className="mt-[4px] flex min-w-0 items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {debt.paidOff && <span className="shrink-0 rounded-[4px] bg-[var(--ph-up-panel)] px-[5px] font-semibold text-[var(--ph-up-ink)]">Paid off</span>}
            {!debt.paidOff && debt.late && <span className="shrink-0 rounded-[4px] bg-[var(--ph-alarm-panel)] px-[5px] font-semibold text-[var(--ph-alarm)]">Late</span>}
            <span className="truncate">{debt.late && !debt.paidOff ? allDebtsSubtitle(debt, today).replace(/^Late · /, '') : allDebtsSubtitle(debt, today)}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * A row of the two groups (card instalments, option C): a debt, opening its own page, or a running instalment plan,
 * opening the plan's page. The figure is a month's under Fixed each month and what is owed under No fixed amount.
 */
function GroupLine({ row, first }: { row: GroupedDebtRow; first: boolean }) {
  const percent = Math.min(100, Math.round((row.progress.current / Math.max(1, row.progress.target)) * 100));
  const look = 'ph-focus flex items-center gap-3 px-[16px] py-[11px]';
  const body = (
    <>
        <span aria-hidden className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[13px] font-semibold text-[var(--ph-ink-2)]">
          {row.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[16px] leading-[21px] font-medium text-[var(--ph-ink)]">{row.name}</span>
            <span className="tabular shrink-0 text-[15px] text-[var(--ph-ink)]">{formatMinor(row.valueMinor, row.currency)}</span>
          </span>
          <span
            role="progressbar"
            aria-label={`${row.name} repaid`}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-[6px] block h-[4px] overflow-hidden rounded-full bg-[var(--ph-track)]"
          >
            <span className={`block h-full rounded-full ${row.late ? 'bg-[var(--ph-alarm)]' : 'bg-[var(--ph-up)]'}`} style={{ width: `${percent}%` }} />
          </span>
          <span className="mt-[4px] flex min-w-0 items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {row.late && <span className="shrink-0 rounded-[4px] bg-[var(--ph-alarm-panel)] px-[5px] font-semibold text-[var(--ph-alarm)]">Late</span>}
            <span className="truncate">{row.late ? row.subtitle.replace(/^Late · /, '') : row.subtitle}</span>
          </span>
        </span>
    </>
  );
  return (
    <li data-testid="all-debts-row" data-name={row.name} className="relative">
      {!first && <Hair />}
      {row.plan ? (
        <Link to="/cards/$cardId/settings/instalments/$planId" params={{ cardId: row.plan.cardAccountId, planId: row.plan.planId }} className={look}>
          {body}
        </Link>
      ) : (
        <Link {...debtDestination(row.debt!)} className={look}>
          {body}
        </Link>
      )}
    </li>
  );
}

/** All debts (spec §4.3): every debt the plan counts, filtered by chip and sorted, the paid off ones last. */
export function AllDebtsPage() {
  const today = isoDate();
  const { model, error } = useDebtPlan();
  const [filter, setFilter] = useState<DebtFilter>('all');
  const [sort, setSort] = useState<DebtSort>(() => readSort());
  const debts = model?.debts ?? [];
  const counts = chipCounts(debts);
  const shown = sortDebts(filterDebts(debts, filter), sort);
  const active = shown.filter((d) => !d.paidOff);
  const paidOff = shown.filter((d) => d.paidOff);
  // Grouped by whether a debt asks a fixed amount each month; a card's running instalment plans are rows of their own
  // there, and leave the card's own figure (option C). Late and Paid off list debts alone.
  const plans = useInstallments();
  const groups = debtGroups(active, filter === 'all' || filter === 'active' ? (plans.data ?? []) : [], today);

  return (
    <div className={SCREEN}>
      <PushedTitle title="All debts" back="Debt-free plan" backTo="/net-worth/plan" />
      <ErrorBox error={error} />
      {model && (
        <>
          <SortMenu
            sort={sort}
            onSort={(next) => {
              setSort(next);
              writeSort(next);
            }}
          />
          <div role="radiogroup" aria-label="Show" className="mb-[14px] flex flex-wrap gap-2">
            {CHIPS.map((chip) => {
              const on = chip.key === filter;
              return (
                <button
                  key={chip.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`ph-focus rounded-full px-[12px] py-[6px] text-[14px] font-medium ${on ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-surface)] text-[var(--ph-ink)]'}`}
                  onClick={() => setFilter(chip.key)}
                >
                  {`${chip.label} ${counts[chip.key]}`}
                </button>
              );
            })}
          </div>
          {groups.fixed.length > 0 && (
            <Panel pad={false} header="Fixed each month" trailing="A month" testId="debts-fixed">
              <ul>
                {groups.fixed.map((row, index) => (
                  <GroupLine key={row.key} row={row} first={index === 0} />
                ))}
              </ul>
            </Panel>
          )}
          {groups.noFixed.length > 0 && (
            <Panel pad={false} header="No fixed amount" trailing="Owed" testId="debts-no-fixed">
              <ul>
                {groups.noFixed.map((row, index) => (
                  <GroupLine key={row.key} row={row} first={index === 0} />
                ))}
              </ul>
            </Panel>
          )}
          {paidOff.length > 0 && (
            <Panel pad={false} header="Paid off">
              <ul>
                {paidOff.map((debt, index) => (
                  <DebtLine key={debt.key} debt={debt} today={today} first={index === 0} />
                ))}
              </ul>
            </Panel>
          )}
          {shown.length === 0 && <p className="py-8 text-center text-sm text-[var(--ph-ink-3)]">None here.</p>}
        </>
      )}
    </div>
  );
}
