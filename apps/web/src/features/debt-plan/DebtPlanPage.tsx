import { isoDate, monthOf } from '@expanses/core';
import type { DebtPlanSettings } from '@expanses/db';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CalendarDays, ListOrdered, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SegmentedControl } from '../../ui/native';
import { PlanHeader } from './PlanHeader';
import { ExtraControls, MethodControl, settingsOf } from './PlanControls';
import { methodLabel, payFirstRows } from './plan-view';
import { PlanTable } from './PlanTable';
import { type DebtPlanModel, useDebtPlan, useDebtPlanSettings, usePlanMonth, useSaveDebtPlanSettings } from './queries';
import { SchedulePanel } from './SchedulePanel';
import { dueThisMonthCount } from './schedule-view';

type PlanTab = 'plan' | 'schedule' | 'report';

/** The tabs a wide screen switches between, drop by drop (spec §4.5). */
const TABS: { key: PlanTab; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'schedule', label: 'Schedule' },
];

/** "3 due this month", or nothing until the month is read. */
function ScheduleValue() {
  const month = monthOf(isoDate());
  const { items } = usePlanMonth(month);
  return items ? <>{`${dueThisMonthCount(items, month)} due this month`}</> : null;
}

/**
 * The Debt-free plan (spec §4.0): a page of its own, opened from Net worth, Liabilities, Account and the sidebar. It
 * reads every debt the Liabilities page reads and never posts; each Pay opens the debt's own existing sheet.
 */
export function DebtPlanPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const { model, error } = useDebtPlan();
  const navigate = useNavigate();
  const search = useSearch({ from: '/net-worth/plan' });
  const tab: PlanTab = TABS.some((t) => t.key === search.tab) ? search.tab! : 'plan';
  const [month, setMonth] = useState(() => monthOf(isoDate()));

  return (
    <div className={SCREEN}>
      <PushedTitle title="Debt-free plan" back="Net worth" backTo="/net-worth" />
      <ErrorBox error={error} />
      {model && model.debts.length === 0 && (
        <>
          <Empty>Nothing owed. Debts added on Liabilities show up here.</Empty>
          <InsetGroup>
            <InsetRow icon={<Wallet size={16} aria-hidden />} title="Liabilities" to="/net-worth/loans" />
          </InsetGroup>
        </>
      )}
      {model && model.debts.length > 0 && !phone && (
        <>
          <SegmentedControl
            label="View"
            className="mb-[18px] max-w-[360px]"
            segments={TABS}
            value={tab}
            onChange={(key) => void navigate({ to: '/net-worth/plan', search: key === 'plan' ? {} : { tab: key as PlanTab }, replace: true })}
          />
          {tab === 'plan' && <WidePlan model={model} baseCurrency={ws.baseCurrency} />}
          {tab === 'schedule' && <SchedulePanel month={month} onMonth={setMonth} show={{ loans: true, cards: true, bills: true }} today={isoDate()} />}
        </>
      )}
      {model && model.debts.length > 0 && phone && (
        <>
          <PlanHeader model={model} baseCurrency={ws.baseCurrency} />
          <InsetGroup>
            <InsetRow icon={<ListOrdered size={16} aria-hidden />} title="Pay first" value={methodLabel(model.method)} to="/net-worth/plan/pay-first" testId="plan-row-pay-first" />
            <InsetRow icon={<CalendarDays size={16} aria-hidden />} title="Schedule" value={<ScheduleValue />} to="/net-worth/plan/schedule" testId="plan-row-schedule" />
          </InsetGroup>
        </>
      )}
    </div>
  );
}

/**
 * The plan on a wide screen (spec §4.5): the header, the order and the extra in a fixed left column, and the numbered
 * list as a table beside them. Moving debts by hand stays on Pay first, which the wide screen still opens.
 */
function WidePlan({ model, baseCurrency }: { model: DebtPlanModel; baseCurrency: string }) {
  const settings = useDebtPlanSettings();
  const saveSettings = useSaveDebtPlanSettings();
  const [saveError, setSaveError] = useState<unknown>(null);
  const saved = settingsOf(settings.data);
  const save = (next: DebtPlanSettings) => {
    setSaveError(null);
    saveSettings(next).catch(setSaveError);
  };
  const rows = payFirstRows(model.debts, model.effect.plan.order, model.extraMinor, baseCurrency);
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-6" data-testid="plan-wide">
      <div className="min-w-0">
        <PlanHeader model={model} baseCurrency={baseCurrency} />
        <MethodControl model={model} saved={saved} save={save} width={260} />
        <ExtraControls model={model} saved={saved} save={save} baseCurrency={baseCurrency} />
        <ErrorBox error={saveError} />
      </div>
      <div className="min-w-0">
        <PlanTable rows={rows} />
        {model.method === 'byHand' && (
          <InsetGroup>
            <InsetRow icon={<ListOrdered size={16} aria-hidden />} title="Set the order by hand" to="/net-worth/plan/pay-first" />
          </InsetGroup>
        )}
      </div>
    </div>
  );
}
