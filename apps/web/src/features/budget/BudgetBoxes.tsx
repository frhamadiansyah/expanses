import { formatMinor } from '@expanses/core';
import type { AccountRow, BudgetSheetResult } from '@expanses/db';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { SPLIT_COLOURS, SPLIT_TITLE } from '../essential-split/split-view';
import { BOX, BoxHead } from '../transactions/CashflowBoxes';
import { BudgetGauge } from '../transactions/BudgetGauge';
import { budgetProgress } from '../transactions/budget-progress';
import type { LookLine } from './budget-desk-model';
import { planSplit, type SplitSheetKey, splitSheetView, type SpendingView } from './budget-view';

/*
 * The boxes along the top of the wide screen's Budget (Mac Budget, the list version): the month's gauge, the
 * Essential · Lifestyle split and what needs a look on Spending; the take-home's plan, goals and the month so far on
 * Plan. Drawn from the sheet the page has read, each figure the phone's own.
 */

/** A label and a figure on one line of a box, a hairline between lines. */
function Line({ label, value, tone, testId, onClick }: { label: ReactNode; value: ReactNode; tone?: string; testId?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-[var(--ph-ink)]">{label}</span>
      <span className={cx('shrink-0 tabular-nums', tone ?? 'text-[var(--ph-ink)]')}>
        {value}
      </span>
    </>
  );
  const row = 'flex w-full items-center gap-3 border-t border-[var(--ph-hair)] px-[14px] py-[7px] text-[13px] first:border-t-0';
  return onClick ? (
    <button type="button" data-testid={testId} onClick={onClick} className={cx(row, 'hover:bg-[var(--ph-fill)]')}>
      {inner}
    </button>
  ) : (
    <div data-testid={testId} className={row}>
      {inner}
    </div>
  );
}

/** This month's budget: the phone's gauge, with what was spent under the budgets, what they add up to, and what no budget covers. */
export function MonthBudgetBox({ title, sheet, view, currency, month, today, monthStart, daysNote }: {
  title: string;
  sheet: BudgetSheetResult;
  view: SpendingView;
  currency: string;
  month: string;
  today: string;
  monthStart: number;
  daysNote: string | null;
}) {
  return (
    <section className={BOX} aria-label={title} data-testid="left-to-spend">
      <BoxHead title={title} note={daysNote ?? undefined} />
      <div className="flex items-center gap-[12px] px-[14px] pb-[10px]">
        <div className="w-[184px] shrink-0">
          <BudgetGauge progress={budgetProgress(sheet.lines)} currency={currency} month={month} today={today} monthStart={monthStart} plain />
        </div>
        <div className="min-w-0 flex-1 text-[12.5px]">
          {[
            ['Spent', view.spentMinor, 'spent-of-budget'],
            ['Budgeted', view.budgetedMinor, 'budgeted-total'],
            ['Not budgeted', view.noBudgetMinor, 'not-budgeted'],
          ].map(([label, minor, testId]) => (
            <div key={label as string} className="flex justify-between gap-3 border-t border-[var(--ph-hair)] py-[5px] first:border-t-0">
              <span className="whitespace-nowrap text-[var(--ph-ink-3)]">{label}</span>
              <span data-testid={testId as string} className="whitespace-nowrap text-[var(--ph-ink)] tabular-nums">
                {formatMinor(minor as number, currency)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SPLIT_WORDS: Record<SplitSheetKey, { label: string; testId: string }> = {
  essential: { label: 'Essential', testId: 'essential-spent' },
  lifestyle: { label: 'Lifestyle', testId: 'lifestyle-spent' },
  debtsSavings: { label: 'Debts & savings', testId: 'debts-savings-spent' },
};

/** What the month went on, as shares of what was bought (Budget › Essential and lifestyle on the phone), cashback beneath. */
export function SplitBox({ sheet, currency }: { sheet: BudgetSheetResult; currency: string }) {
  const view = splitSheetView(sheet);
  return (
    <section className={BOX} aria-label={SPLIT_TITLE} data-testid="split-box">
      <BoxHead title={SPLIT_TITLE} />
      <span aria-hidden data-testid="split-bar" className="mx-[14px] mt-[4px] mb-[8px] flex h-[8px] overflow-hidden rounded-[4px] bg-[var(--ph-track)]">
        {view.bar && (
          <>
            <span className="block h-full" style={{ width: `${view.bar.essential}%`, background: SPLIT_COLOURS.essential }} />
            <span className="block h-full" style={{ width: `${view.bar.lifestyle}%`, background: SPLIT_COLOURS.lifestyle }} />
            <span className="block h-full" style={{ width: `${view.bar.debtsSavings}%`, background: SPLIT_COLOURS.debtsSavings }} />
          </>
        )}
      </span>
      <div>
        {view.rows.map((row) => (
          <Line
            key={row.key}
            label={
              <span className="inline-flex items-center gap-[7px]">
                <i aria-hidden className="block h-[8px] w-[8px] rounded-[2px]" style={{ background: SPLIT_COLOURS[row.key] }} />
                {SPLIT_WORDS[row.key].label}
              </span>
            }
            value={
              <>
                <span className="text-[var(--ph-ink-3)]">{row.percent} · </span>
                {formatMinor(row.amountMinor, currency)}
              </>
            }
            testId={SPLIT_WORDS[row.key].testId}
          />
        ))}
        {view.cashbackMinor !== null && <Line label="Cashback & Rewards" value={formatMinor(view.cashbackMinor, currency)} tone="text-[var(--ph-ink-3)]" testId="cashback-total" />}
      </div>
    </section>
  );
}

/** Needs a look: the categories over, those nearly there with the days left, and how many spent with no budget. */
export function LookBox({ lines, currency, daysNote, accounts, onOpen, onSet }: {
  lines: readonly LookLine[];
  currency: string;
  daysNote: string | null;
  accounts: readonly AccountRow[];
  onOpen: (categoryId: string) => void;
  onSet: () => void;
}) {
  return (
    <section className={BOX} aria-label="Needs a look" data-testid="needs-a-look">
      <BoxHead title="Needs a look" />
      <div>
        {lines.length === 0 && <p className="px-[14px] pt-[2px] pb-[10px] text-[12.5px] text-[var(--ph-ink-3)]">Every budget is under 85%.</p>}
        {lines.map((line) => {
          if (line.kind === 'unbudgeted') {
            return (
              <Line
                key="unbudgeted"
                label={line.count === 1 ? '1 category without a budget' : `${line.count} categories without a budget`}
                value="Set…"
                tone="text-[var(--mac-accent)]"
                onClick={onSet}
              />
            );
          }
          const name = (
            <span className="inline-flex min-w-0 items-center gap-[7px]">
              <CategoryIcon categoryId={line.categoryId} accounts={accounts} size="xs" />
              <span className="truncate">{line.kind === 'over' ? `${line.name} over` : `${line.name} at ${line.percent}%`}</span>
            </span>
          );
          return line.kind === 'over' ? (
            <Line key={line.categoryId} label={name} value={`−${formatMinor(line.overMinor, currency)}`} tone="text-[var(--ph-alarm)]" onClick={() => onOpen(line.categoryId)} />
          ) : (
            <Line key={line.categoryId} label={name} value={daysNote ?? ''} tone="text-[var(--ph-warn)]" onClick={() => onOpen(line.categoryId)} />
          );
        })}
      </div>
    </section>
  );
}

const PLAN_COLOURS = { debt: 'var(--ph-ink-2)', goals: 'var(--ph-info-ink)', budgeted: 'var(--ph-up)', unplanned: 'var(--ph-track)' } as const;

/** The take-home and how it divides: debt first, then goals and budgets, and what nothing is planned for. */
export function TakeHomeBox({ sheet, currency, onTakeHome }: { sheet: BudgetSheetResult; currency: string; onTakeHome: () => void }) {
  const split = planSplit({ incomeMinor: sheet.incomePlanMinor, debtMinor: sheet.debtPaymentsPlanMinor, goalsMinor: sheet.savingsPlanMinor, budgetedMinor: sheet.capsTotalMinor });
  return (
    <section className={BOX} aria-label="Take-home" data-testid="take-home-card">
      <BoxHead title="Take-home" note={sheet.incomeOverridden ? 'Just this month' : undefined} />
      <span aria-hidden className="mx-[14px] mt-[4px] mb-[6px] flex h-[8px] gap-[2px] overflow-hidden rounded-[4px] bg-[var(--ph-track)]">
        {split.scaleMinor > 0 &&
          split.parts
            .filter((part) => part.minor > 0)
            .map((part) => <span key={part.key} className="block h-full" style={{ width: `${(part.minor / split.scaleMinor) * 100}%`, background: PLAN_COLOURS[part.key] }} />)}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 px-[14px] pb-[6px] text-[11.5px] text-[var(--ph-ink-3)]" data-testid="plan-legend">
        {split.parts.map((part) => (
          <li key={part.key} className="flex items-center gap-[5px]">
            <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: PLAN_COLOURS[part.key] }} />
            {part.label} {part.percent === null ? '—' : `${part.percent}%`}
          </li>
        ))}
      </ul>
      <div>
        <Line label={sheet.incomeOverridden ? 'Take-home · Just this month' : 'Take-home'} value={formatMinor(sheet.incomePlanMinor, currency)} testId="income-line" onClick={onTakeHome} />
        <Line label="Debt payments" value={formatMinor(sheet.debtPaymentsPlanMinor, currency)} testId="debt-line" />
        <Line label="Budgeted" value={formatMinor(sheet.capsTotalMinor, currency)} testId="caps-total" />
        <Line label="Unplanned" value={formatMinor(sheet.leftOverPlanMinor, currency)} tone="text-[var(--ph-ink-3)]" testId="left-over-plan" />
        {sheet.eventSpendingMinor > 0 && (
          <Line label={sheet.eventsInCaps ? 'Events (inside the budgets)' : 'Events (outside the budgets)'} value={formatMinor(sheet.eventSpendingMinor, currency)} testId="event-line" />
        )}
      </div>
    </section>
  );
}

/** Each goal with what it needs a month and what was set aside for it this month. */
export function GoalsBox({ sheet, currency }: { sheet: BudgetSheetResult; currency: string }) {
  return (
    <section className={BOX} aria-label="Goals">
      <BoxHead title="Goals" note={sheet.savings.length > 0 ? 'set aside this month' : undefined} />
      <div>
        {sheet.savings.length === 0 && <p className="px-[14px] pt-[2px] pb-[10px] text-[12.5px] text-[var(--ph-ink-3)]">No goals ask for money this month.</p>}
        {sheet.savings.map((row) => (
          <div key={row.goalId} data-testid={`savings-${row.name}`} className="border-t border-[var(--ph-hair)] px-[14px] py-[6px] text-[13px] first:border-t-0">
            <div className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1 truncate text-[var(--ph-ink)]">{row.name}</span>
              <span className="shrink-0 text-[var(--ph-ink)] tabular-nums">{formatMinor(row.actualMinor, currency)}</span>
            </div>
            <div className="text-[11.5px] text-[var(--ph-ink-3)] tabular-nums">needs {formatMinor(row.planMinor, currency)} a month</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The month as it has gone so far (⋯ Month so far on the phone): in, out, and what is left over. */
export function MonthSoFarBox({ sheet, currency }: { sheet: BudgetSheetResult; currency: string }) {
  return (
    <section className={BOX} aria-label="Month so far">
      <BoxHead title="Month so far" />
      <div>
        <Line label="Take-home received" value={formatMinor(sheet.incomeActualMinor, currency)} tone="text-[var(--ph-up)]" />
        <Line label="Spent" value={formatMinor(sheet.spendingActualMinor, currency)} testId="month-spent" />
        {sheet.eventSpendingMinor > 0 && !sheet.eventsInCaps && <Line label="Events" value={formatMinor(sheet.eventSpendingMinor, currency)} />}
        <Line label="Debt payments" value={formatMinor(sheet.debtPaymentsActualMinor, currency)} />
        <Line label="Set aside for goals" value={formatMinor(sheet.savingsActualMinor, currency)} />
        <Line label="Left over" value={formatMinor(sheet.leftOverActualMinor, currency)} tone={sheet.leftOverActualMinor < 0 ? 'text-[var(--ph-alarm)]' : undefined} testId="left-over-actual" />
      </div>
    </section>
  );
}
